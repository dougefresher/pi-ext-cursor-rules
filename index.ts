/**
 * Cursor Rules Extension for pi-coding-agent
 *
 * Loads project rules from .cursor/rules/ (*.md, *.mdc) and applies them
 * based on Cursor-style frontmatter:
 *
 *   alwaysApply: true           -> injected into system prompt every turn
 *   globs: "*.ts" (+ optional description) -> blocks read/write/edit on matching
 *                                  files until rules are present in context
 *   description only            -> listed in system prompt for agent to decide
 *
 * Reference: https://docs.cursor.com/context/rules
 *
 * Adapted from pi-mdc-rules by Manuel Levi & Enlightenment.AI (EAI LICENSE v1.1)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

// -- Types ------------------------------------------------------------------

interface CursorRule {
  name: string;
  filePath: string;
  content: string;
  globs?: string[];
  alwaysApply: boolean;
  description?: string;
}

// -- Frontmatter parser -----------------------------------------------------

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const yamlBlock = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  const meta: Record<string, unknown> = {};

  const lines = yamlBlock.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    // Multiline block scalars: `|` (literal) or `>` (folded)
    if (rest === '|' || rest === '>') {
      const folded = rest === '>';
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] === '' || /^\s+/.test(lines[i]!))) {
        blockLines.push(lines[i]!.replace(/^\s+/, ''));
        i++;
      }
      const joined = folded ? blockLines.join(' ').replace(/\s+/g, ' ').trim() : blockLines.join('\n').trim();
      if (joined) meta[key] = joined;
      continue;
    }

    // YAML list (indented `- item` lines)
    if (rest === '' || rest === '[]') {
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s/.test(lines[i]!)) {
        items.push(
          lines[i]!.replace(/^\s+-\s+/, '')
            .replace(/^['"]|['"]$/g, '')
            .trim(),
        );
        i++;
      }
      if (items.length > 0) meta[key] = items;
      continue;
    }

    // Inline array [a, b, c]
    if (rest.startsWith('[')) {
      const inner = rest.slice(1, rest.lastIndexOf(']'));
      meta[key] = inner
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (rest === 'true') {
      meta[key] = true;
    } else if (rest === 'false') {
      meta[key] = false;
    } else {
      meta[key] = rest.replace(/^['"]|['"]$/g, '');
    }
    i++;
  }

  return { meta, body };
}

function parseGlobs(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

// -- Glob matching ----------------------------------------------------------

function expandBraces(glob: string): string[] {
  const match = glob.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!match) return [glob];
  const [, prefix = '', alternatives = '', suffix = ''] = match;
  return alternatives.split(',').map((alt) => `${prefix}${alt.trim()}${suffix}`);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/^\.\//, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(filePath: string, glob: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  for (const g of expandBraces(glob)) {
    const regex = globToRegex(g);
    if (regex.test(normalized)) return true;
    // For globs without path separators, also match against basename
    if (!g.includes('/') && regex.test(path.basename(normalized))) return true;
  }
  return false;
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  return globs.some((g) => matchesGlob(filePath, g));
}

// -- Rule loading -----------------------------------------------------------

function findRuleFiles(dir: string, basePath = ''): string[] {
  if (!fs.existsSync(dir)) return [];

  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const rel = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...findRuleFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
      results.push(rel);
    }
  }
  return results;
}

function loadRules(rulesDir: string): CursorRule[] {
  const files = findRuleFiles(rulesDir);
  const rules: CursorRule[] = [];

  for (const file of files) {
    const filePath = path.join(rulesDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      if (!body) continue;

      const alwaysApply = meta.alwaysApply === true;
      const globs = parseGlobs(meta.globs);
      const description = typeof meta.description === 'string' ? meta.description : undefined;

      rules.push({
        name: file.replace(/\.(md|mdc)$/, ''),
        filePath,
        content: body,
        globs: !alwaysApply ? globs : undefined,
        alwaysApply,
        description,
      });
    } catch {
      // skip unreadable files
    }
  }

  return rules;
}

// -- Context checking -------------------------------------------------------

function contentHash(rules: CursorRule[]): string {
  const combined = rules.map((r) => r.content).join('\n');
  return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 8);
}

function buildFileRulesTag(filePath: string, matchingRules: CursorRule[]): string {
  const names = matchingRules
    .map((r) => r.name)
    .sort()
    .join(',');
  const hash = contentHash(matchingRules);
  const rulesText = matchingRules.map((r) => `### ${r.name}\n\n${r.content}`).join('\n\n---\n\n');
  return `<file-rules path="${filePath}" rules="${names}" hash="${hash}">\n${rulesText}\n</file-rules>`;
}

function contextHasAllRules(
  filePath: string,
  requiredNames: string[],
  hash: string,
  sessionManager: { getBranch(): { type: string; message?: any }[] },
): boolean {
  const sorted = [...requiredNames].sort().join(',');
  const tagPattern = `<file-rules path="${filePath}" rules="${sorted}" hash="${hash}">`;

  const branch = sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]!;
    if (entry.type !== 'message' || !entry.message) continue;

    const msg = entry.message as Record<string, unknown>;
    const content = msg.content;
    if (typeof content === 'string' && content.includes(tagPattern)) return true;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'string' && part.includes(tagPattern)) return true;
        if (
          part &&
          typeof part === 'object' &&
          'text' in part &&
          typeof part.text === 'string' &&
          part.text.includes(tagPattern)
        )
          return true;
      }
    }
    if (typeof msg.reason === 'string' && msg.reason.includes(tagPattern)) return true;
    if (msg.details && typeof msg.details === 'object') {
      if (JSON.stringify(msg.details).includes(tagPattern)) return true;
    }
  }
  return false;
}

// -- Extension --------------------------------------------------------------

export default function cursorRules(pi: ExtensionAPI) {
  let rules: CursorRule[] = [];
  let projectCwd = '';

  function reloadRules() {
    rules = [];
    if (!projectCwd) return;
    rules = loadRules(path.join(projectCwd, '.cursor', 'rules'));
  }

  pi.on('session_start', (_event, ctx) => {
    projectCwd = ctx.cwd;
    reloadRules();

    if (rules.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`Cursor rules: ${rules.length} rule(s) loaded from .cursor/rules/`, 'info');
    }
  });

  // Inject always-apply rules and list intelligent/glob rules in system prompt
  pi.on('before_agent_start', (event) => {
    reloadRules();

    const always = rules.filter((r) => r.alwaysApply);
    const byGlob = rules.filter((r) => !r.alwaysApply && r.globs?.length);
    const intelligent = rules.filter((r) => !r.alwaysApply && !r.globs?.length && r.description);

    if (!always.length && !byGlob.length && !intelligent.length) return;

    let append = '';

    if (always.length > 0) {
      append += '\n\n## Project Rules (Always Apply)\n\n';
      for (const r of always) {
        append += `### ${r.name}\n\n${r.content}\n\n`;
      }
    }

    if (byGlob.length > 0) {
      append += '\n\n## File-Specific Rules\n\n';
      append += 'These rules are enforced before you can edit matching files:\n\n';
      for (const r of byGlob) {
        const globs = r.globs!.join(', ');
        const desc = r.description ? ` -- ${r.description}` : '';
        append += `- **${r.name}** (\`${globs}\`)${desc}\n`;
      }
    }

    if (intelligent.length > 0) {
      append += '\n\n## Available Rules\n\n';
      append += 'Read these rule files when relevant to your current task:\n\n';
      for (const r of intelligent) {
        append += `- **${r.name}**: ${r.description} (\`${r.filePath}\`)\n`;
      }
    }

    return { systemPrompt: event.systemPrompt + append };
  });

  // Block file operations on glob-matched files until rules are in context
  pi.on('tool_call', (event, ctx) => {
    if (event.toolName !== 'write' && event.toolName !== 'edit' && event.toolName !== 'read') return;

    const filePath = (event.input.path as string | undefined) ?? '';
    if (!filePath) return;

    reloadRules();

    const matching = rules.filter((r) => !r.alwaysApply && r.globs?.length && matchesAnyGlob(filePath, r.globs));
    if (!matching.length) return;

    const requiredNames = matching.map((r) => r.name);
    const hash = contentHash(matching);

    if (contextHasAllRules(filePath, requiredNames, hash, ctx.sessionManager)) {
      return; // rules already in context, allow through
    }

    const tag = buildFileRulesTag(filePath, matching);

    if (ctx.hasUI) {
      ctx.ui.notify(`Cursor rules: ${matching.length} rule(s) apply to ${path.basename(filePath)}`, 'info');
    }

    return {
      block: true,
      reason: `The following rules apply to "${filePath}". Read them carefully and retry your operation.\n\n${tag}`,
    };
  });
}
