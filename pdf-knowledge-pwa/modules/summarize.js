// Tier A extractive summary, grouped per file.
//
// Output shape: an array of "sections" — one per file that has a hit. Each
// section has the file name, a short prose paragraph synthesized from the top
// 1–2 most-relevant sentences in that file, and the list of pages it draws
// from (rendered as compact citations like `[p.7, p.16]`). Citations are
// click-targets so the UI can jump to the right page.
//
// This is intentionally tighter than dumping every matched sentence — fewer
// sentences, deduplicated phrasing, citations consolidated per file. Real
// neural summarisation goes in the (planned) Tier B path.

const STOPWORDS = new Set('a an and are as at be but by for from has have he her his i in is it its of on or our she that the their them they this to was we were what when where which who why will with you your'.split(' '));

function tokenize(s) {
  return (s || '').toLowerCase().match(/[a-z0-9֐-׿]+/g) || [];
}

function splitSentences(text) {
  if (!text) return [];
  const raw = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9֐-׿])/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 25 && s.length < 600);
}

function scoreSentence(sentence, queryTerms, df, totalDocs) {
  const tokens = tokenize(sentence).filter((t) => !STOPWORDS.has(t));
  if (!tokens.length) return 0;
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const q of queryTerms) {
    const f = tf.get(q) || 0;
    if (!f) continue;
    const docFreq = df.get(q) || 1;
    const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
    score += idf * (f * (1.5 + 1)) / (f + 1.5 * (0.25 + 0.75 * tokens.length / 25));
  }
  // Lightly penalise very short or very long sentences.
  const lengthPenalty = sentence.length < 60 ? 0.85 : sentence.length > 280 ? 0.85 : 1;
  return score * lengthPenalty;
}

function buildDocFrequency(hits) {
  const df = new Map();
  for (const h of hits) {
    const seen = new Set();
    for (const t of tokenize(h.text + ' ' + (h.annotationsText || ''))) {
      if (STOPWORDS.has(t) || seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  return df;
}

function jaccard(a, b) {
  const A = new Set(tokenize(a).filter((t) => !STOPWORDS.has(t)));
  const B = new Set(tokenize(b).filter((t) => !STOPWORDS.has(t)));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function tidy(sentence) {
  // Trim leading list bullets / page numbers / dotted leaders that show up in
  // tables of contents — they look ugly in a summary paragraph.
  let s = sentence.replace(/^[•\-–—]\s*/, '');
  s = s.replace(/\.{4,}/g, ' '); // ".........."
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Make sure it ends with punctuation.
  if (s && !/[.!?…]$/.test(s)) s += '.';
  return s;
}

/**
 * @returns {{ sections: Array<{ fileId, fileName, paragraph, citations }>, citations: Array }}
 */
export function extractiveSummary(query, hits, { maxSentencesPerFile = 2, maxFiles = 4 } = {}) {
  if (!hits.length) return { sections: [], citations: [] };
  const queryTerms = tokenize(query).filter((t) => !STOPWORDS.has(t));
  if (!queryTerms.length) return { sections: [], citations: [] };

  // Score sentences within each hit page.
  const df = buildDocFrequency(hits);
  const byFile = new Map(); // fileId -> { fileName, candidates: [] }
  for (const h of hits) {
    const combined = (h.text || '') + (h.annotationsText ? '\n' + h.annotationsText : '');
    for (const sent of splitSentences(combined)) {
      const score = scoreSentence(sent, queryTerms, df, hits.length);
      if (score <= 0) continue;
      let bucket = byFile.get(h.fileId);
      if (!bucket) {
        bucket = { fileId: h.fileId, fileName: h.fileName, candidates: [] };
        byFile.set(h.fileId, bucket);
      }
      bucket.candidates.push({ sentence: tidy(sent), score, pageNum: h.pageNum });
    }
  }

  const sections = [];
  const citations = [];
  let citationIdx = 0;

  // Rank files by best sentence score.
  const fileBuckets = [...byFile.values()]
    .map((b) => ({ ...b, top: Math.max(0, ...b.candidates.map((c) => c.score)) }))
    .sort((a, b) => b.top - a.top)
    .slice(0, maxFiles);

  for (const bucket of fileBuckets) {
    bucket.candidates.sort((a, b) => b.score - a.score);
    const picked = [];
    for (const c of bucket.candidates) {
      // Skip near-duplicates of already-picked sentences.
      if (picked.some((p) => jaccard(p.sentence, c.sentence) > 0.6)) continue;
      // Don't repeat the same page beyond once unless we need to.
      if (picked.filter((p) => p.pageNum === c.pageNum).length >= 1 && picked.length >= 1) continue;
      picked.push(c);
      if (picked.length >= maxSentencesPerFile) break;
    }
    if (!picked.length) continue;
    // Restore reading order within the section.
    picked.sort((a, b) => a.pageNum - b.pageNum);

    // Build prose: join sentences, append a single citation list at the end.
    const pages = [...new Set(picked.map((p) => p.pageNum))].sort((a, b) => a - b);
    const fileCitations = pages.map((pageNum) => {
      const idx = citationIdx++;
      const cite = { idx, fileId: bucket.fileId, fileName: bucket.fileName, pageNum, query };
      citations.push(cite);
      return cite;
    });
    const paragraph = picked.map((p) => p.sentence).join(' ');
    sections.push({
      fileId: bucket.fileId,
      fileName: bucket.fileName,
      paragraph,
      citations: fileCitations,
    });
  }

  return { sections, citations };
}
