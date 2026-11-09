// Tidying whisper's output on the way out of the library.
//
// Done on read rather than on write: it reaches the hundred and fifty
// episodes already transcribed, and leaves what is on disk untouched, so a
// marker removed here can be put back by changing one regex rather than by
// re-transcribing a show.
//
// `>>` is whisper's speaker-change marker. It is not something anybody says,
// and it sits at the front of 2,368 cues in this library.
//
// Deliberately left alone, because each is arguable and none was asked for:
//   -       3,842  dialogue dash
//   [...]   1,008  sound annotations, "[singing]"
//   (...)     327  "(scatting)"
//   ♪          51  lyrics
const SPEAKER_MARKER = /\s*>>\s*/g;

function cleanCueText(text) {
    if (typeof text !== 'string') return text;
    if (!text.includes('>>')) return text;   // the overwhelming majority
    // A marker mid-cue separates two speakers, so it becomes a space rather
    // than nothing — otherwise the two utterances run together into one word.
    return text.replace(SPEAKER_MARKER, ' ').trim();
}

module.exports = { cleanCueText };
