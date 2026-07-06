// local-video:// protocol handler with HTTP range-request support, so
// <video> seeking is instant and multi-GB files stream from disk instead
// of being buffered into memory.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const VIDEO_MIME_TYPES = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.ogv': 'video/ogg', '.ts': 'video/mp2t', '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac'
};

function registerLocalVideoProtocol(protocol) {
    protocol.handle('local-video', (request) => {
        const url = new URL(request.url);
        let filePath = decodeURIComponent(url.pathname);
        if (process.platform === 'win32' && filePath.startsWith('/')) {
            filePath = filePath.slice(1);
        }

        try {
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const rangeHeader = request.headers.get('range');
            const contentType = VIDEO_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'video/mp4';

            // Streams the file after the Response has been handed back, so a
            // file deleted mid-playback errors on the stream with no listener —
            // swallow it instead of crashing the main process.
            const toBody = (stream) => {
                stream.on('error', () => {});
                return Readable.toWeb(stream);
            };

            if (rangeHeader) {
                const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
                if (match && (match[1] || match[2])) {
                    let start;
                    let end;
                    if (match[1]) {
                        start = parseInt(match[1], 10);
                        end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
                    } else {
                        // Suffix range: bytes=-500 → the last 500 bytes
                        const suffix = Math.min(parseInt(match[2], 10), fileSize);
                        start = fileSize - suffix;
                        end = fileSize - 1;
                    }

                    if (start >= fileSize || start > end || Number.isNaN(start)) {
                        return new Response('Range not satisfiable', {
                            status: 416,
                            headers: { 'Content-Range': `bytes */${fileSize}` }
                        });
                    }

                    const chunkSize = end - start + 1;
                    const stream = fs.createReadStream(filePath, { start, end });

                    return new Response(toBody(stream), {
                        status: 206,
                        headers: {
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': String(chunkSize),
                            'Content-Type': contentType
                        }
                    });
                }
            }

            return new Response(toBody(fs.createReadStream(filePath)), {
                status: 200,
                headers: {
                    'Content-Length': String(fileSize),
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes'
                }
            });
        } catch (e) {
            return new Response('File not found', { status: 404 });
        }
    });
}

module.exports = { registerLocalVideoProtocol };
