import { isDesktop, invoke } from './desktop';

/**
 * Getting a file in and out of the editor.
 *
 * The two shells reach the user's filesystem differently and there is no
 * hiding that: the desktop app opens a native dialog through Rust, a browser
 * tab gets a file input and a download. Both are behind the same two functions
 * so nothing above this line has to care, which is the same bargain the
 * backends make for the diagram store.
 */

export interface PickedFile {
  /** File name alone — used in messages, never to find the file again. */
  name: string;
  text: string;
}

/** Open a file picker. An empty list means the user cancelled. */
export async function pickFiles(): Promise<PickedFile[]> {
  if (isDesktop()) return invoke<PickedFile[]>('transfer_pick_files');
  return pickFilesInBrowser();
}

/**
 * Write a file somewhere the user chooses.
 *
 * Returns where it went when that is knowable — the desktop app gets a real
 * path back, a browser only ever knows the file name it suggested.
 */
export async function saveFile(suggestedName: string, contents: string): Promise<string | null> {
  if (isDesktop()) {
    return invoke<string | null>('transfer_save_file', { suggestedName, contents });
  }
  downloadInBrowser(suggestedName, contents);
  return suggestedName;
}

/* ------------------------------------------------------------------ *
 * The browser half
 * ------------------------------------------------------------------ */

function pickFilesInBrowser(): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.json,application/json';
    // Off-screen rather than hidden: a display:none input is ignored by some
    // browsers, and it has to be in the document for `cancel` to fire.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);

    const done = (result: PickedFile[] | Error) => {
      input.remove();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    input.addEventListener('cancel', () => done([]));
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return done([]);
      Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      ).then(done, (err: unknown) => done(err instanceof Error ? err : new Error(String(err))));
    });

    input.click();
  });
}

function downloadInBrowser(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Freed on the next tick: revoking synchronously can beat the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
