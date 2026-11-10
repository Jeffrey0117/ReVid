import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isRemoteSource, isHlsUrl, toPlayableSrc, nameFromUrl, downloadNameFor
} from './remoteSource.js';

test('a URL is remote, a path is not', () => {
    assert.equal(isRemoteSource('https://example.com/a.mp4'), true);
    assert.equal(isRemoteSource('http://example.com/a.mp4'), true);
    assert.equal(isRemoteSource('  https://example.com/a.mp4  '), true);
    assert.equal(isRemoteSource(String.raw`C:\Users\AUSER\Videos\a.mp4`), false);
    assert.equal(isRemoteSource('/home/me/a.mp4'), false);
    assert.equal(isRemoteSource(''), false);
    assert.equal(isRemoteSource(null), false);
});

// file:// and local-video:// are not things to hand to a <video> as-is here,
// and neither is a UNC path pretending to be a URL.
test('only http and https count as remote', () => {
    assert.equal(isRemoteSource('file:///C:/a.mp4'), false);
    assert.equal(isRemoteSource('local-video:///C:/a.mp4'), false);
    assert.equal(isRemoteSource(String.raw`\\nas\share\a.mp4`), false);
});

test('HLS is recognised through a query string', () => {
    assert.equal(isHlsUrl('https://h/x.m3u8'), true);
    assert.equal(isHlsUrl('https://h/x.m3u8?token=abc&t=1'), true);
    assert.equal(isHlsUrl('https://h/x.m3u8#frag'), true);
    assert.equal(isHlsUrl('https://h/x.mp4'), false);
    assert.equal(isHlsUrl('https://h/m3u8-notes.mp4'), false);
});

// The bug this exists to prevent: percent-encoding every segment of a URL.
test('a URL is passed through, a path is encoded', () => {
    const url = 'https://example.com/dir/a b.m3u8?k=1';
    assert.equal(toPlayableSrc(url), url);
    assert.ok(toPlayableSrc(String.raw`C:\V\a b.mp4`).startsWith('local-video:///'));
    assert.equal(toPlayableSrc(''), null);
    assert.equal(toPlayableSrc(null), null);
});

test('a name is taken from the last segment and decoded', () => {
    assert.equal(nameFromUrl('https://h/dir/My%20Show.mp4'), 'My Show.mp4');
    assert.equal(nameFromUrl('https://h/dir/a.mp4?token=x'), 'a.mp4');
    assert.equal(nameFromUrl('not a url'), '');
});

// "index.m3u8" names the playlist, not the video; the folder above it does.
test('a generic playlist name falls back to the folder above', () => {
    assert.equal(nameFromUrl('https://h/some-episode/index.m3u8'), 'some-episode');
    assert.equal(nameFromUrl('https://h/ep12/master.m3u8?x=1'), 'ep12');
    assert.equal(nameFromUrl('https://h/playlist.m3u8'), 'playlist.m3u8');
});

test('what lands on disk is always a real video file name', () => {
    assert.equal(downloadNameFor('https://h/ep12/index.m3u8'), 'ep12.mp4');
    assert.equal(downloadNameFor('https://h/dir/a.m3u8'), 'a.mp4');
    assert.equal(downloadNameFor('https://h/dir/a.mp4'), 'a.mp4');
    assert.equal(downloadNameFor('https://h/dir/noext'), 'noext.mp4');
});
