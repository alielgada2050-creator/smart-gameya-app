/**
 * Attach a receipt (or a promissory note) four ways: take a photo now, pick from the photo gallery, pick a file (PDF or image),
 * or paste / drop an image on a computer. On phones the camera button opens the phone's own camera (best quality, works in the
 * installed Android and iOS apps); on a computer with a webcam it opens a live camera here.
 * Large photos are reduced to 2000 px and re-encoded as JPEG before upload: faster on mobile data, under the 5 MB limit,
 * and the photo's hidden metadata (such as location) is dropped.
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n.ts';

const MAX = 5 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const canLiveCamera = () => !!navigator.mediaDevices?.getUserMedia && !coarse();

/** Downscale and re-encode photos; PDFs and small images pass through untouched. */
export async function prepareFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  const needsWork = file.size > 1_500_000 || !ACCEPTED.includes(file.type);
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const longest = Math.max(bmp.width, bmp.height);
    if (!needsWork && longest <= 2000) return file;
    const k = Math.min(1, 2000 / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'receipt') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file; // the server checks type and size again and says what is wrong
  } finally { bmp?.close(); }
}

export function ReceiptPicker({ label, file, onChange, allowPdf = true }: { label: string; file: File | null; onChange: (f: File | null) => void; allowPdf?: boolean }) {
  const { t } = useT();
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function take(raw: File | null | undefined) {
    if (!raw) return;
    setProblem(''); setBusy(true);
    try {
      const f = await prepareFile(raw);
      if (!ACCEPTED.includes(f.type) || (!allowPdf && f.type === 'application/pdf')) setProblem(t.rc.badType);
      else if (f.size > MAX) setProblem(t.rc.tooBig);
      else onChange(f);
    } finally { setBusy(false); }
  }

  // Paste a screenshot of the bank app straight in (computers, and phones with a clipboard image).
  useEffect(() => {
    if (file) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && (i.type.startsWith('image/') || i.type === 'application/pdf'));
      if (item) { e.preventDefault(); void take(item.getAsFile()); }
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  });

  const pick = (input: HTMLInputElement | null) => { if (input) { input.value = ''; input.click(); } };
  const camera = () => (canLiveCamera() ? setLive(true) : pick(camRef.current));

  return (
    <div className="stack-sm receipt-picker" data-testid="receipt-picker">
      <span className="field-label">{label}</span>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden data-testid="rc-camera" onChange={(e) => take(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="image/*" hidden data-testid="rc-gallery" onChange={(e) => take(e.target.files?.[0])} />
      <input ref={fileRef} type="file" accept={allowPdf ? ACCEPTED.join(',') : 'image/png,image/jpeg,image/webp'} hidden data-testid="rc-file" onChange={(e) => take(e.target.files?.[0])} />
      {file ? (
        <div className="rc-chosen" aria-live="polite">
          {preview ? <img src={preview} alt={t.rc.previewAlt} className="rc-thumb" /> : <span className="rc-doc" aria-hidden="true">PDF</span>}
          <span className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
            <strong className="rc-name">{file.name}</strong>
            <span className="muted small">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
          </span>
          <span className="rc-chosen-actions">
            <button type="button" className="btn btn-ghost btn-xs" onClick={camera}>{t.rc.retake}</button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange(null)}>{t.rc.remove}</button>
          </span>
        </div>
      ) : (
        <div className={`rc-drop${drag ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files?.[0]); }}>
          <div className="rc-buttons">
            <button type="button" className="rc-btn" onClick={camera} disabled={busy}><RcIcon d="M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /><span>{t.rc.camera}</span></button>
            <button type="button" className="rc-btn" onClick={() => pick(galRef.current)} disabled={busy}><RcIcon d="M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9.5a1.5 1.5 0 1 0 0-.01" /><span>{t.rc.gallery}</span></button>
            <button type="button" className="rc-btn" onClick={() => pick(fileRef.current)} disabled={busy}><RcIcon d="M14 3H6v18h12V7z M14 3v4h4 M9 13h6 M9 17h6" /><span>{t.rc.files}</span></button>
          </div>
          <p className="muted small rc-hint">{busy ? t.rc.preparing : coarse() ? t.rc.hintPhone : t.rc.hintDesk}</p>
        </div>
      )}
      {problem && <p className="notice error small" role="alert">{problem}</p>}
      {live && <LiveCamera onClose={() => setLive(false)} onShot={(f) => { setLive(false); void take(f); }} onFail={() => { setLive(false); pick(camRef.current); }} />}
    </div>
  );
}

function RcIcon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** Live camera for computers (and any browser that allows it): back camera first, switchable, one tap to capture. */
function LiveCamera({ onClose, onShot, onFail }: { onClose: () => void; onShot: (f: File) => void; onFail: () => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [cams, setCams] = useState(0);
  const [ready, setReady] = useState(false); // frames are flowing: only then can a tap capture something
  const [error, setError] = useState('');

  useEffect(() => {
    let s: MediaStream | null = null; let gone = false; setReady(false);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (m) => {
        if (gone) { m.getTracks().forEach((x) => x.stop()); return; }
        s = m; setStream(m);
        if (video.current) { video.current.srcObject = m; await video.current.play().catch(() => {}); }
        const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCams(devs.filter((d) => d.kind === 'videoinput').length);
      })
      .catch((e) => setError(e?.name === 'NotAllowedError' ? t.rc.denied : t.rc.noCamera));
    return () => { gone = true; s?.getTracks().forEach((x) => x.stop()); };
  }, [facing]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  function shoot() {
    const v = video.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(new File([b], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  }

  return (
    <div className="cam-overlay" role="dialog" aria-modal="true" aria-label={t.rc.camera} data-testid="live-camera">
      <div className="cam-box">
        {error ? (
          <div className="stack-sm cam-error">
            <p role="alert">{error}</p>
            <div className="row-start"><button type="button" className="btn btn-primary" onClick={onFail}>{t.rc.files}</button><button type="button" className="btn btn-ghost" onClick={onClose}>{t.cancel}</button></div>
          </div>
        ) : (
          <>
            <video ref={video} playsInline muted autoPlay className="cam-video" onPlaying={() => setReady(true)} />
            <div className="cam-frame" aria-hidden="true" />
            <div className="cam-actions">
              <button type="button" className="btn btn-ghost-dark" onClick={onClose}>{t.cancel}</button>
              <button type="button" className="cam-shutter" onClick={shoot} disabled={!stream || !ready} aria-label={t.rc.shoot}><span /></button>
              {cams > 1 ? <button type="button" className="btn btn-ghost-dark" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>{t.rc.flip}</button> : <span style={{ width: 72 }} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
