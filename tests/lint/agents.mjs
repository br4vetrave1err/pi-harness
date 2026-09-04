#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const lines = fm.split('\n');
  const data = {};
  let currentKey = null;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line) && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(line.replace(/^\s*-\s+/, '').trim());
    } else if (line.includes(':')) {
      const idx = line.indexOf(':');
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      // handle list start with dash on same line or empty
      if (val === '' ) {
        currentKey = key;
        if (!data[key]) data[key] = [];
      } else {
        // strip quotes
        val = val.replace(/^["']|["']$/g, '');
        // handle tools comma separated
        if (key === 'tools' && val.includes(',')) {
          data[key] = val.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          data[key] = val;
        }
        currentKey = key;
      }
    }
  }
  return data;
}

function checkCoder(file) {
  const content = fs.readFileSync(file, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm) throw new Error(`${file}: missing frontmatter ---`);
  const tools = Array.isArray(fm.tools) ? fm.tools.join(',') : String(fm.tools || '');
  if (!tools.includes('default.subagent')) throw new Error(`${file}: tools must include default.subagent (got ${tools})`);
  if (String(fm.inheritProjectContext).toLowerCase() !== 'true') throw new Error(`${file}: inheritProjectContext must be true`);
  if (String(fm.defaultContext).toLowerCase() !== 'fork') throw new Error(`${file}: defaultContext must be fork`);
  if (String(fm.thinking).toLowerCase() !== 'xhigh') throw new Error(`${file}: thinking must be xhigh (got ${fm.thinking})`);
  // also check that file contains some content beyond frontmatter
  if (!content.includes('coder')) throw new Error(`${file}: content missing coder`);
  console.log(`✓ coder ${path.basename(file)} ok — tools:${tools.slice(0,60)} thinking:${fm.thinking}`);
}

function checkTester(file) {
  const content = fs.readFileSync(file, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm) throw new Error(`${file}: missing frontmatter`);
  const toolsStr = Array.isArray(fm.tools) ? fm.tools.join(',') : String(fm.tools || content);
  if (toolsStr.includes('default.subagent')) throw new Error(`${file}: tester must NOT contain default.subagent (leaf)`);
  if (!content.includes('Test verdict:')) throw new Error(`${file}: must contain Test verdict: template`);
  if (!content.includes('PASS') || !content.includes('FAIL')) throw new Error(`${file}: must contain PASS/FAIL`);
  const thinking = String(fm.thinking || '').toLowerCase();
  if (!['high','medium','low','xhigh'].includes(thinking)) throw new Error(`${file}: thinking must be high|medium|low|xhigh (got ${fm.thinking})`);
  if (thinking !== 'high') console.warn(`! tester thinking is ${thinking} expected high`);
  console.log(`✓ tester ${path.basename(file)} ok — thinking:${fm.thinking}`);
}

let failed = false;
try {
  const coderPath = path.join(root, '.pi/agents/coder.md');
  const testerPath = path.join(root, '.pi/agents/tester.md');
  if (!fs.existsSync(coderPath)) throw new Error(`missing ${coderPath}`);
  if (!fs.existsSync(testerPath)) throw new Error(`missing ${testerPath}`);
  checkCoder(coderPath);
  checkTester(testerPath);
  // also check project-level .pi/agents/coder.md baked copy should match user-level? Not required but warn if diverges
  const projCoder = path.join(root, '.pi/agents/coder.md'); // top-level agents maps to project, but .pi/agents is top-level already
  // Check that Dockerfile bake would succeed: ensure file exists
  if (fs.existsSync(projCoder)) {
    // already checked
  }
  console.log('All agent contracts passed');
} catch (e) {
  console.error(`✕ lint failed: ${e.message}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
