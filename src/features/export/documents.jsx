import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { latinOrMixed } from './pdfFonts';

// Typography carried over from pdfluv2, where it was tuned over several
// rounds for printing: Latin is set larger than CJK because Times at the same
// nominal size reads noticeably smaller than a square glyph.
const styles = StyleSheet.create({
    page: {
        paddingTop: 60, paddingBottom: 72, paddingHorizontal: 62,
        fontSize: 10.5, color: '#1a1a1a', fontFamily: 'NotoTC'
    },
    header: {
        marginBottom: 24, paddingBottom: 11,
        borderBottomWidth: 0.75, borderBottomColor: '#1a1a1a'
    },
    title: { fontSize: 16, color: '#111111' },
    subtitle: { fontSize: 8, color: '#8a8a8a', marginTop: 5, letterSpacing: 0.5 },

    sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 9 },
    sectionLine: { flexGrow: 1, height: 0.5, backgroundColor: '#c9c9c9' },
    sectionLabel: { fontSize: 8, color: '#6b6b6b', marginHorizontal: 9, letterSpacing: 1 },

    cueRow: { flexDirection: 'row', marginBottom: 7 },
    stamp: {
        width: 44, fontSize: 7.5, color: '#9a9a9a',
        fontFamily: 'NotoLatin', paddingTop: 2.5
    },
    cueBody: { flex: 1 },
    original: {
        fontFamily: 'Times-Roman', fontSize: 12, lineHeight: 1.45, color: '#2e2e2e'
    },
    translation: { fontSize: 10.5, lineHeight: 1.44, color: '#5a5a5a', marginTop: 1 },

    entry: {
        paddingVertical: 7,
        borderBottomWidth: 0.5, borderBottomColor: '#dcdcdc'
    },
    entryHead: { flexDirection: 'row', alignItems: 'baseline' },
    entryNum: { width: 24, fontSize: 7, color: '#9a9a9a', fontFamily: 'NotoLatin' },
    entryWord: { fontFamily: 'Times-Bold', fontSize: 12, color: '#111111' },
    entryPhonetic: { fontFamily: 'NotoLatin', fontSize: 7.5, color: '#8a8a8a', marginLeft: 6 },
    entryTags: { fontFamily: 'Helvetica', fontSize: 6.5, color: '#b05a2a', marginLeft: 6 },
    entryDef: { fontSize: 9.5, lineHeight: 1.44, color: '#2e2e2e', marginTop: 3, marginLeft: 24 },
    entryExample: {
        fontFamily: 'Times-Italic', fontSize: 9, lineHeight: 1.4,
        color: '#5a5a5a', marginTop: 3, marginLeft: 24
    },
    entryExampleZh: { fontSize: 8.5, lineHeight: 1.4, color: '#8a8a8a', marginLeft: 24 },

    footer: {
        position: 'absolute', bottom: 32, left: 0, right: 0,
        textAlign: 'center', fontSize: 8.5, color: '#6b6b6b', fontFamily: 'NotoLatin'
    },
    empty: { fontSize: 10, color: '#8a8a8a', marginTop: 20 }
});

const TAG_LABELS = { cet4: 'CET4', cet6: 'CET6', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE' };

function stamp(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function Header({ title, subtitle }) {
    return (
        <View style={styles.header}>
            <Text style={latinOrMixed(title, styles.title)}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
    );
}

function Footer() {
    return (
        <Text
            fixed
            style={styles.footer}
            render={({ pageNumber }) => `— ${pageNumber} —`}
        />
    );
}

// A printable transcript. Sections are one per source video, so a series of
// talks compiles into a single book.
export function TranscriptPdf({ title, sections, showTranslation }) {
    const total = sections.reduce((n, s) => n + s.cues.length, 0);
    return (
        <Document title={title}>
            <Page size="A4" style={styles.page} wrap>
                <Header
                    title={title}
                    subtitle={`${sections.length} video${sections.length === 1 ? '' : 's'} · ${total} lines · ReVid`}
                />
                {sections.map((section, si) => (
                    <View key={si}>
                        {sections.length > 1 && (
                            // minPresenceAhead stops a section title being
                            // stranded alone at the foot of a page.
                            <View style={styles.sectionRow} minPresenceAhead={60}>
                                <View style={styles.sectionLine} />
                                <Text style={latinOrMixed(section.title, styles.sectionLabel)}>
                                    {section.title}
                                </Text>
                                <View style={styles.sectionLine} />
                            </View>
                        )}
                        {section.cues.map((cue, ci) => (
                            <View key={ci} style={styles.cueRow} wrap={false}>
                                <Text style={styles.stamp}>{stamp(cue.start)}</Text>
                                <View style={styles.cueBody}>
                                    <Text style={latinOrMixed(cue.text, styles.original)}>
                                        {cue.text}
                                    </Text>
                                    {showTranslation && cue.zh ? (
                                        <Text style={styles.translation}>{cue.zh}</Text>
                                    ) : null}
                                </View>
                            </View>
                        ))}
                    </View>
                ))}
                <Footer />
            </Page>
        </Document>
    );
}

// Study notes: the hard words, each with the line it appeared in.
export function WordbookPdf({ title, words }) {
    return (
        <Document title={title}>
            <Page size="A4" style={styles.page} wrap>
                <Header title={title} subtitle={`${words.length} words · ReVid`} />
                {words.length === 0 && (
                    <Text style={styles.empty}>No words collected.</Text>
                )}
                {words.map((w, i) => (
                    // An entry split across a page break is unreadable.
                    <View key={`${w.word}-${i}`} style={styles.entry} wrap={false}>
                        <View style={styles.entryHead}>
                            <Text style={styles.entryNum}>{String(i + 1).padStart(3, '0')}</Text>
                            <Text style={styles.entryWord}>{w.word}</Text>
                            {w.phonetic ? (
                                <Text style={styles.entryPhonetic}>/{w.phonetic}/</Text>
                            ) : null}
                            {w.tags?.length ? (
                                <Text style={styles.entryTags}>
                                    {w.tags.map(t => TAG_LABELS[t] || t.toUpperCase()).join(' · ')}
                                </Text>
                            ) : null}
                        </View>
                        <Text style={styles.entryDef}>{w.definition}</Text>
                        {w.example ? (
                            <Text style={latinOrMixed(w.example, styles.entryExample)}>
                                “{w.example}”
                            </Text>
                        ) : null}
                        {w.exampleZh ? (
                            <Text style={styles.entryExampleZh}>{w.exampleZh}</Text>
                        ) : null}
                    </View>
                ))}
                <Footer />
            </Page>
        </Document>
    );
}
