import express, { Request, Response } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const PORT = process.env.PORT || 8080;

// phrases.txt から候補リストを読み込み
const phraseFilePath = path.join(__dirname, '../phrases.txt');
let PHRASE_LIST: string[] = [];

try {
  const fileContent = fs.readFileSync(phraseFilePath, 'utf-8');
  PHRASE_LIST = fileContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  console.log(`Loaded ${PHRASE_LIST.length} phrases from phrases.txt`);
} catch (error) {
  console.error('Failed to read phrases.txt:', error);
  process.exit(1);
}

const githubAxios = axios.create({
  baseURL: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
  },
});

app.post('/generate', async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }

  try {
    const runsResponse = await githubAxios.get('/actions/workflows/main.yml/runs');
    const hasActiveWorkflow = runsResponse.data.workflow_runs.some(
      (run: any) => run.status === 'in_progress' || run.status === 'queued'
    );

    if (hasActiveWorkflow) {
      res.status(503).json({ error: 'ただいま裏側でハッカーが作業中です。しばらくお待ちください。' });
      return;
    }

    let selectedId: string | null = null;

    for (const phrase of PHRASE_LIST) {
      try {
        await githubAxios.get(`/contents/l/db/${phrase}.json`);
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          selectedId = phrase;
          break;
        }
        throw error;
      }
    }

    if (!selectedId) {
      const commitsResponse = await githubAxios.get('/commits', {
        params: { path: 'l/db', per_page: 1, direction: 'asc' },
      });

      if (commitsResponse.data.length > 0) {
        const commitSha = commitsResponse.data[0].sha;
        const commitDetail = await githubAxios.get(`/commits/${commitSha}`);
        const oldestFile = commitDetail.data.files.find((f: any) => f.filename.startsWith('l/db/'));
        
        if (oldestFile) {
          selectedId = oldestFile.filename.replace('l/db/', '').replace('.json', '');
        }
      }
    }

    if (!selectedId) {
      res.status(500).json({ error: '利用可能なIDが見つかりませんでした' });
      return;
    }

    res.json({ success: true, id: selectedId, shortUrl: `https://${GITHUB_OWNER}.github.io/l/${selectedId}/` });

    await githubAxios.post('/dispatches', {
      event_type: 'create-shortcut',
      client_payload: { id: selectedId, url: url },
    });

  } catch (error: any) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});