import { Font } from '@react-pdf/renderer';

// react-pdf ships no CJK support at all: it breaks lines on spaces, and CJK
// text has none, so a paragraph of Chinese renders as one unbreakable run
// that overflows the page. The hyphenation callback below is what makes CJK
// wrap — and it also enforces 禁則処理, keeping punctuation off line starts
// and opening brackets off line ends.
export const CJK_PATTERN = /[　-〿一-鿿豈-﫿＀-￯]/;

const NO_LINE_START = new Set('、。，．！？；：）」』】》〉…—％‰℃·');
const NO_LINE_END = new Set('「『（【《〈');

let registered = false;

export function registerPdfFonts() {
    if (registered) return;
    registered = true;

    // Served from the renderer origin (Vite in dev, the loopback static
    // server when packaged). The browser build of @react-pdf/font fetches
    // font sources, so a filesystem path would not work here.
    Font.register({
        family: 'NotoTC',
        fonts: [{ src: '/fonts/NotoSansTC-Regular.ttf', fontWeight: 'normal' }]
    });
    // Times/Helvetica are built into pdfkit, but neither has IPA glyphs.
    Font.register({
        family: 'NotoLatin',
        fonts: [{ src: '/fonts/NotoSans-Regular.ttf', fontWeight: 'normal' }]
    });

    Font.registerHyphenationCallback((word) => {
        if (!CJK_PATTERN.test(word)) return [word];
        const parts = [];
        for (const ch of Array.from(word)) {
            const prev = parts.length > 0 ? parts[parts.length - 1] : '';
            if (prev && (NO_LINE_START.has(ch) || NO_LINE_END.has(prev.slice(-1)))) {
                parts[parts.length - 1] = prev + ch;
            } else {
                parts.push(ch);
            }
        }
        // Empty strings are break opportunities between glyphs.
        return parts.flatMap((p) => [p, '']);
    });
}

// Times has no CJK glyphs, so a line that mixes scripts must fall back.
export function latinOrMixed(text, baseStyle) {
    return CJK_PATTERN.test(text) ? [baseStyle, { fontFamily: 'NotoTC' }] : baseStyle;
}
