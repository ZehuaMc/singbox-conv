import fs from 'node:fs/promises';
import path from 'node:path';
import { EXAMPLE_TEMPLATE_PATH, TEMPLATE_PATH } from './config.js';

export async function readTemplateText() {
  try {
    return {
      content: await fs.readFile(templatePath(), 'utf8'),
      usingExample: false,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return {
      content: await fs.readFile(EXAMPLE_TEMPLATE_PATH, 'utf8'),
      usingExample: true,
    };
  }
}

export async function readTemplateJson() {
  const { content } = await readTemplateText();
  return parseTemplateContent(content);
}

export async function writeTemplateText(content) {
  const normalizedContent = normalizeTemplateContent(content);
  const target = templatePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, normalizedContent, { mode: 0o600 });
  return {
    content: normalizedContent,
    usingExample: false,
  };
}

function normalizeTemplateContent(content) {
  parseTemplateContent(content);
  return `${content.trimEnd()}\n`;
}

function parseTemplateContent(content) {
  if (typeof content !== 'string') {
    throw new TemplateValidationError('config.json content must be a string');
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new TemplateValidationError('config.json cannot be empty');
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new TemplateValidationError(`config.json contains invalid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TemplateValidationError('config.json must contain a JSON object');
  }

  return parsed;
}

function templatePath() {
  return process.env.TEMPLATE_PATH
    ? path.resolve(process.env.TEMPLATE_PATH)
    : TEMPLATE_PATH;
}

export class TemplateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TemplateValidationError';
    this.status = 400;
  }
}
