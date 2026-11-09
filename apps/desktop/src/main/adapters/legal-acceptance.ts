import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  legalBundleSchema,
  legalReceiptSchema,
  type LegalBundle,
  type LegalReceipt,
} from '@caselite/contracts';
import type { LegalAcceptancePort } from '@caselite/application';

export function loadLegalBundle(directory: string): LegalBundle {
  const documents = (
    [
      ['license', 'CaseLite 专有软件许可证', 'LICENSE.md'],
      ['eula', 'CaseLite 最终用户许可协议', 'EULA.md'],
    ] as const
  ).map(([id, title, file]) => {
    const bytes = readFileSync(join(directory, file));
    return {
      id,
      title,
      text: bytes.toString('utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const document_set_hash = createHash('sha256')
    .update(documents.map(({ id, sha256 }) => `${id}:${sha256}`).join('\n'))
    .digest('hex');
  return legalBundleSchema.parse({ effective_date: '2026-11-09', document_set_hash, documents });
}

export function createLegalAcceptance(root: string): LegalAcceptancePort {
  const file = join(root, 'legal-acceptance.json');
  const read = (): LegalReceipt | null => {
    if (!existsSync(file)) return null;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
      throw new Error('Invalid legal acceptance file');
    return legalReceiptSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  };
  return {
    read,
    write(receipt) {
      // 未知或损坏的旧记录保留；仅替换本机协议记录，不接触案件库和凭据。
      read();
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(legalReceiptSchema.parse(receipt)), {
          mode: 0o600,
          flag: 'wx',
        });
        const fd = openSync(temporary, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, file);
        const directory = openSync(root, 'r');
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      } finally {
        rmSync(temporary, { force: true });
      }
    },
  };
}
