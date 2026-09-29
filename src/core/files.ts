/** The user's own audio files, kept as the original Blob in IndexedDB (db `lull`, store `files`). */
export interface FileRecord {
  id: string;
  name: string;
  blob: Blob;
}

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('lull', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

export const allFiles = async (): Promise<FileRecord[]> => {
  try {
    const db = await open();
    return await new Promise(res => {
      const q = db.transaction('files').objectStore('files').getAll();
      q.onsuccess = () => res((q.result as FileRecord[]) || []);
      q.onerror = () => res([]);
    });
  } catch {
    return [];
  }
};

const tx = async (fn: (st: IDBObjectStore) => void) => {
  try {
    const db = await open();
    await new Promise<void>(res => {
      const t = db.transaction('files', 'readwrite');
      fn(t.objectStore('files'));
      t.oncomplete = () => res();
      t.onerror = () => res();
    });
  } catch {
    /* storage unavailable: the file still plays this session */
  }
};

export const putFile = (rec: FileRecord) => tx(st => st.put(rec));
export const deleteFile = (id: string) => tx(st => st.delete(id));

/** Decode without needing a running AudioContext (works before the first tap). */
export const decode = (data: ArrayBuffer) => new OfflineAudioContext(2, 1, 44100).decodeAudioData(data);
