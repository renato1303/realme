import { AIClip } from '../types';

interface SavedAnalysis {
  fileKey: string; // name + size + lastModified
  completedBlocks: number[];
  clips: AIClip[];
  totalBlocks: number;
  isFinished: boolean;
  timestamp?: number;
}

export interface ExportHistoryItem {
  id: string;
  filename: string;
  type: 'video' | 'batch-zip' | 'image';
  timestamp: number;
  aspectRatio: string;
  headline: string;
  downloadUrl?: string;
}

const DB_NAME = 'ReelsFrameStudioDB';
const ANALYSES_STORE = 'analyses';
const EXPORTS_STORE = 'exports';
const DB_VERSION = 2;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(ANALYSES_STORE)) {
        db.createObjectStore(ANALYSES_STORE, { keyPath: 'fileKey' });
      }
      if (!db.objectStoreNames.contains(EXPORTS_STORE)) {
        db.createObjectStore(EXPORTS_STORE, { keyPath: 'id' });
      }
    };
  });
}

export async function saveAnalysisState(state: SavedAnalysis): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ANALYSES_STORE, 'readwrite');
    const store = transaction.objectStore(ANALYSES_STORE);
    const request = store.put({ ...state, timestamp: state.timestamp || Date.now() });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function loadAnalysisState(fileKey: string): Promise<SavedAnalysis | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ANALYSES_STORE, 'readonly');
    const store = transaction.objectStore(ANALYSES_STORE);
    const request = store.get(fileKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function loadAllAnalyses(): Promise<SavedAnalysis[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ANALYSES_STORE, 'readonly');
    const store = transaction.objectStore(ANALYSES_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

export async function clearAnalysisState(fileKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ANALYSES_STORE, 'readwrite');
    const store = transaction.objectStore(ANALYSES_STORE);
    const request = store.delete(fileKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function saveExportHistory(item: ExportHistoryItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EXPORTS_STORE, 'readwrite');
    const store = transaction.objectStore(EXPORTS_STORE);
    const request = store.put(item);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function loadExportHistory(): Promise<ExportHistoryItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EXPORTS_STORE, 'readonly');
    const store = transaction.objectStore(EXPORTS_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const items = request.result || [];
      items.sort((a, b) => b.timestamp - a.timestamp);
      resolve(items);
    };
  });
}

export async function clearExportHistory(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EXPORTS_STORE, 'readwrite');
    const store = transaction.objectStore(EXPORTS_STORE);
    const request = store.clear();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export function getFileKey(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}`;
}
