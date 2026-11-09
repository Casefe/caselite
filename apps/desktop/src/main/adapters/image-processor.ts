import { nativeImage } from 'electron';
import { release } from 'node:os';
import type { PdfProcessorPort } from '@caselite/application';
import { imageDimensions } from './image-dimensions';
import { recognizeLocalImage } from './local-vision';
export function createImageProcessor(): PdfProcessorPort {
  return {
    configuration: `image-vision-r3-accurate-zh-Hans-zh-Hant-en_v1_9MP_macos-${release()}`,
    async inspect(bytes) {
      imageDimensions(bytes);
      return 1;
    },
    async process(bytes, input) {
      const size = imageDimensions(bytes);
      const blocks = input.ocr ? await recognizeLocalImage(bytes, input.signal) : [];
      if (input.signal.aborted) throw new Error('Cancelled');
      input.onPage({
        page: 1,
        text: blocks.map((row) => row.text).join('\n'),
        origin: input.ocr ? 'ocr_candidate' : 'needs_ocr',
        blocks,
        ...size,
        rotation: 0,
      });
    },
    async render(bytes, pages, signal) {
      if (signal?.aborted || pages.some((page) => page !== 1) || pages.length !== 1)
        throw new Error('Invalid image selection');
      imageDimensions(bytes);
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (image.isEmpty()) throw new Error('Invalid photo');
      const result = image.toPNG();
      if (result.length > 16 * 1024 * 1024) throw new Error('Image byte budget');
      return [result.toString('base64')];
    },
  };
}
