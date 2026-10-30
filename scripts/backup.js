// Copie cohérente de la base, même pendant que le site tourne (API backup de SQLite).
// Usage : node scripts/backup.js <fichier de destination>
import { DatabaseSync, backup } from 'node:sqlite';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage : node scripts/backup.js <fichier de destination>');
  process.exit(2);
}
const db = new DatabaseSync(process.env.DB_PATH || 'var/isoloir.db', { readOnly: true });
await backup(db, destination);
db.close();
