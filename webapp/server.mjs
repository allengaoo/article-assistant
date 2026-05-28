import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createApp } from './create-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[GZH Webapp] Running on http://0.0.0.0:${PORT}`);
});
