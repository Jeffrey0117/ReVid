/**
 * Video Crop Pipeline
 *
 * Source MP4 -> fetch as ArrayBuffer
 *   -> mp4box.js demux (video + audio tracks)
 *   -> VideoDecoder -> crop each frame on OffscreenCanvas -> VideoEncoder
 *   -> Audio chunks pass-through (no decode/re-encode)
 *   -> mp4-muxer -> ArrayBuffer output
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import * as MP4Box from 'mp4box';

const ENCODER_CODECS = [
    'avc1.4D0028',
    'avc1.42E01E',
    'avc1.42001f',
    'avc1.640028',
];

async function findSupportedEncoderConfig(width, height, bitrate, framerate) {
    for (const codec of ENCODER_CODECS) {
        try {
            const support = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
            if (support.supported) return support.config;
        } catch { /* try next */ }
    }
    return null;
}

export async function cropVideo(videoSrc, cropRect, onProgress = () => {}) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
        throw new Error('WebCodecs API is not available.');
    }

    const { width: srcWidth, height: srcHeight } = await getVideoMetadata(videoSrc);

    const pixelCrop = {
        x: Math.round(cropRect.x),
        y: Math.round(cropRect.y),
        width: Math.round(cropRect.width),
        height: Math.round(cropRect.height)
    };
    pixelCrop.width = pixelCrop.width % 2 === 0 ? pixelCrop.width : pixelCrop.width - 1;
    pixelCrop.height = pixelCrop.height % 2 === 0 ? pixelCrop.height : pixelCrop.height - 1;

    if (pixelCrop.width <= 0 || pixelCrop.height <= 0) throw new Error('Invalid crop dimensions');

    const response = await fetch(videoSrc);
    const sourceBuffer = await response.arrayBuffer();
    const { videoTrack, audioTrack, videoSamples, audioSamples } = await demuxMP4(sourceBuffer);

    if (!videoTrack) throw new Error('No video track found');
    if (!videoTrack.description) throw new Error('Could not extract decoder description');

    const totalFrames = videoSamples.length;
    const framerate = videoTrack.timescale ? (videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale)) : 30;
    const bitrate = Math.max(500_000, Math.min(8_000_000, pixelCrop.width * pixelCrop.height * 4));

    const encoderConfig = await findSupportedEncoderConfig(pixelCrop.width, pixelCrop.height, bitrate, framerate);
    if (!encoderConfig) throw new Error(`No supported H.264 encoder for ${pixelCrop.width}x${pixelCrop.height}`);

    const muxerTarget = new ArrayBufferTarget();
    const muxer = new Muxer({
        target: muxerTarget,
        video: { codec: 'avc', width: pixelCrop.width, height: pixelCrop.height },
        audio: audioTrack ? { codec: 'aac', numberOfChannels: audioTrack.audio.channel_count, sampleRate: audioTrack.audio.sample_rate } : undefined,
        fastStart: 'in-memory'
    });

    const canvas = new OffscreenCanvas(pixelCrop.width, pixelCrop.height);
    const ctx = canvas.getContext('2d');
    let pipelineError = null;
    let framesProcessed = 0;

    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { pipelineError = e; }
    });
    encoder.configure(encoderConfig);

    const decodedFrames = [];
    const decoder = new VideoDecoder({
        output: (frame) => decodedFrames.push(frame),
        error: (e) => { pipelineError = e; }
    });
    decoder.configure({
        codec: getCodecString(videoTrack),
        codedWidth: srcWidth,
        codedHeight: srcHeight,
        description: videoTrack.description
    });

    const BATCH = 20;
    for (let i = 0; i < videoSamples.length; i++) {
        if (pipelineError) break;
        const s = videoSamples[i];
        decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: (s.cts * 1_000_000) / videoTrack.timescale,
            duration: (s.duration * 1_000_000) / videoTrack.timescale,
            data: s.data
        }));

        if ((i + 1) % BATCH === 0 || i === videoSamples.length - 1) {
            await decoder.flush();
            for (const frame of decodedFrames) {
                if (pipelineError || encoder.state !== 'configured') { frame.close(); continue; }
                try {
                    ctx.drawImage(frame, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
                    const nf = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration || undefined });
                    try { encoder.encode(nf, { keyFrame: framesProcessed % 30 === 0 }); } finally { nf.close(); }
                } finally { frame.close(); }
                framesProcessed++;
                onProgress(framesProcessed, totalFrames);
            }
            decodedFrames.length = 0;
            if (encoder.state === 'configured' && encoder.encodeQueueSize > 5) {
                await new Promise(r => setTimeout(r, 10));
            }
        }
    }

    if (encoder.state === 'configured') await encoder.flush();
    if (decoder.state !== 'closed') decoder.close();
    if (encoder.state !== 'closed') encoder.close();
    if (pipelineError) throw new Error(`Video processing failed: ${pipelineError.message || pipelineError}`);

    if (audioTrack && audioSamples.length > 0) {
        for (const s of audioSamples) {
            muxer.addAudioChunk(new EncodedAudioChunk({
                type: s.is_sync ? 'key' : 'delta',
                timestamp: (s.cts * 1_000_000) / audioTrack.timescale,
                duration: (s.duration * 1_000_000) / audioTrack.timescale,
                data: s.data
            }));
        }
    }

    muxer.finalize();
    return muxerTarget.buffer;
}

function getVideoMetadata(src) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true;
        v.onloadedmetadata = () => { resolve({ width: v.videoWidth, height: v.videoHeight }); v.src = ''; };
        v.onerror = () => { reject(new Error('Failed to load video metadata')); v.src = ''; };
        v.src = src;
    });
}

function demuxMP4(sourceBuffer) {
    return new Promise((resolve, reject) => {
        const f = MP4Box.createFile();
        let videoTrack = null, audioTrack = null;
        const videoSamples = [], audioSamples = [];
        let expV = 0, expA = 0, ready = false;

        const tryResolve = () => {
            if (!ready) return;
            if ((!videoTrack || videoSamples.length >= expV) && (!audioTrack || audioSamples.length >= expA)) {
                if (videoTrack) {
                    const trak = f.getTrackById(videoTrack.id);
                    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
                    const box = entry?.avcC || entry?.hvcC;
                    if (box) {
                        const stream = new MP4Box.DataStream(undefined, 0, false);
                        box.write(stream);
                        videoTrack.description = new Uint8Array(stream.buffer, 8);
                    }
                }
                resolve({ videoTrack, audioTrack, videoSamples, audioSamples });
            }
        };

        f.onReady = (info) => {
            for (const t of info.tracks) {
                if (t.type === 'video' && !videoTrack) { videoTrack = t; expV = t.nb_samples; f.setExtractionOptions(t.id, 'video', { nbSamples: Infinity }); }
                else if (t.type === 'audio' && !audioTrack) { audioTrack = t; expA = t.nb_samples; f.setExtractionOptions(t.id, 'audio', { nbSamples: Infinity }); }
            }
            ready = true; f.start();
        };
        f.onSamples = (_, user, samples) => {
            (user === 'video' ? videoSamples : audioSamples).push(...samples);
            tryResolve();
        };
        f.onError = (e) => reject(new Error(`MP4Box: ${e}`));

        const buf = sourceBuffer.slice(0);
        buf.fileStart = 0;
        f.appendBuffer(buf);
        f.flush();
        setTimeout(() => { if (ready) resolve({ videoTrack, audioTrack, videoSamples, audioSamples }); }, 5000);
    });
}

function getCodecString(track) {
    if (track.codec?.startsWith('avc1') || track.codec?.startsWith('hvc1') || track.codec?.startsWith('hev1')) return track.codec;
    return 'avc1.42001f';
}
