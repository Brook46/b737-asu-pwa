// JavaScript for Automation — run by social-notes-sync.sh as
//   FC_FOLDER="AIRPORTS B" osascript -l JavaScript read-notes.js
//
// Prints the folder's notes as JSON: [{ title, html }, …]. READ-ONLY: it
// never creates, edits, moves or deletes a note.
ObjC.import('stdlib');

function run() {
  const want = ObjC.unwrap($.getenv('FC_FOLDER') || '').trim().toUpperCase();
  const Notes = Application('Notes');
  const folder = Notes.folders().find(f => f.name().trim().toUpperCase() === want);
  if (!folder) return JSON.stringify({ error: 'folder not found: ' + want });
  return JSON.stringify(folder.notes().map(n => ({
    title: n.name(),
    // Images are stripped HERE, at the source: Notes inlines them as base64
    // data URIs, which is most of the bytes and nothing the app can show.
    html: n.body().replace(/<img\b[^>]*>/gi, ''),
  })));
}
