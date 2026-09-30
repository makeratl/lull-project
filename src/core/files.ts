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
export const decode = (data: ArrayBuffer, rate = 44100) => new OfflineAudioContext(2, 1, rate).decodeAudioData(data);

/**
 * Drop near-silent samples at either end (at most `max` seconds each). MP3 encoders pad both ends,
 * and some browsers keep that padding when decoding, which would put a gap in every loop.
 */
export const trimEdges = (b: AudioBuffer, floor = 0.002, max = 0.25) => {
  const chs = [...Array(b.numberOfChannels).keys()].map(c => b.getChannelData(c)), lim = Math.round(max * b.sampleRate);
  const loud = (i: number) => chs.some(d => Math.abs(d[i]) > floor);
  let a = 0, z = b.length;
  while (a < lim && a < z - 1 && !loud(a)) a++;
  while (b.length - z < lim && z > a + 1 && !loud(z - 1)) z--;
  if (a === 0 && z === b.length) return b;
  const out = new AudioBuffer({ length: z - a, sampleRate: b.sampleRate, numberOfChannels: b.numberOfChannels });
  chs.forEach((d, c) => out.copyToChannel(d.subarray(a, z), c));
  return out;
};
