import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Printer, QrCode, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  FLOOR_MATERIAL_LABELS,
  WALL_PATTERN_LABELS,
  type ArchPlacedObject,
  type ArchRoomProject,
  type FloorMaterialKind,
  type WallPattern,
} from './types';

interface ClientReportModalProps {
  open: boolean;
  project: ArchRoomProject;
  clientName?: string | null;
  latestRenderDataUrl?: string | null;
  onCaptureViewport: () => string | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}

interface RoomMetrajRow {
  no: string;
  id: string;
  name: string;
  widthM: number;
  depthM: number;
  floorM2: number;
  wallNetM2: number;
  floorLabel: string;
  floorHex: string;
  wallLabel: string;
  wallHex: string;
  cx: number;
  cz: number;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveRoomForObject(obj: ArchPlacedObject, rooms: RoomMetrajRow[]): string {
  for (const r of rooms) {
    if (
      obj.x >= r.cx - r.widthM * 0.5 - 0.15 &&
      obj.x <= r.cx + r.widthM * 0.5 + 0.15 &&
      obj.z >= r.cz - r.depthM * 0.5 - 0.15 &&
      obj.z <= r.cz + r.depthM * 0.5 + 0.15
    ) {
      return r.name;
    }
  }
  return rooms[0]?.name || 'Ana Salon';
}

function buildFloorPlanSvgString(project: ArchRoomProject, rooms: RoomMetrajRow[]): string {
  let minX = -project.widthM * 0.5;
  let maxX = project.widthM * 0.5;
  let minZ = -project.depthM * 0.5;
  let maxZ = project.depthM * 0.5;
  for (const r of rooms) {
    minX = Math.min(minX, r.cx - r.widthM * 0.5);
    maxX = Math.max(maxX, r.cx + r.widthM * 0.5);
    minZ = Math.min(minZ, r.cz - r.depthM * 0.5);
    maxZ = Math.max(maxZ, r.cz + r.depthM * 0.5);
  }
  const padM = 0.75;
  const spanX = Math.max(2, maxX - minX + padM * 2);
  const spanZ = Math.max(2, maxZ - minZ + padM * 2);
  const vbW = 720;
  const vbH = 380;
  const scale = Math.min((vbW - 60) / spanX, (vbH - 60) / spanZ);
  const toX = (mx: number) => vbW * 0.5 + (mx - (minX + maxX) * 0.5) * scale;
  const toY = (mz: number) => vbH * 0.5 + (mz - (minZ + maxZ) * 0.5) * scale;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" style="width:100%;height:auto;display:block;background:#faf9f6;border:1px solid #d6d3d1;">`
  );

  // Subtle architectural dot grid
  for (let gx = Math.floor(minX); gx <= Math.ceil(maxX); gx++) {
    const px = toX(gx);
    parts.push(`<line x1="${px.toFixed(1)}" y1="12" x2="${px.toFixed(1)}" y2="${vbH - 12}" stroke="#eceae4" stroke-width="1"/>`);
  }
  for (let gz = Math.floor(minZ); gz <= Math.ceil(maxZ); gz++) {
    const py = toY(gz);
    parts.push(`<line x1="12" y1="${py.toFixed(1)}" x2="${vbW - 12}" y2="${py.toFixed(1)}" stroke="#eceae4" stroke-width="1"/>`);
  }

  // Room polygons & exact metric dimensions
  for (const r of rooms) {
    const x0 = toX(r.cx - r.widthM * 0.5);
    const y0 = toY(r.cz - r.depthM * 0.5);
    const rw = r.widthM * scale;
    const rh = r.depthM * scale;
    parts.push(
      `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" fill="#ffffff" stroke="#1c1917" stroke-width="2.4"/>`
    );
    parts.push(
      `<text x="${(x0 + rw * 0.5).toFixed(1)}" y="${(y0 + 18).toFixed(1)}" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-size="11" font-weight="700" fill="#1c1917">${escapeHtml(
        `${r.no} ${r.name}`
      )}</text>`
    );
    parts.push(
      `<text x="${(x0 + rw * 0.5).toFixed(1)}" y="${(y0 + 31).toFixed(1)}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9.5" fill="#78716c">${r.widthM.toFixed(
        1
      )} × ${r.depthM.toFixed(1)} m (${r.floorM2.toFixed(1)} m²)</text>`
    );
  }

  // Main room windows (architectural cyan double-line marks)
  for (const w of project.windows || []) {
    const lenM = w.widthCm / 100;
    if (w.wall === 'north' || w.wall === 'south') {
      const z = w.wall === 'north' ? -project.depthM * 0.5 : project.depthM * 0.5;
      const cx = -project.widthM * 0.5 + w.offsetCm / 100;
      parts.push(
        `<line x1="${toX(cx - lenM * 0.5).toFixed(1)}" y1="${toY(z).toFixed(1)}" x2="${toX(cx + lenM * 0.5).toFixed(1)}" y2="${toY(
          z
        ).toFixed(1)}" stroke="#0284c7" stroke-width="5"/>`
      );
    } else {
      const x = w.wall === 'west' ? -project.widthM * 0.5 : project.widthM * 0.5;
      const cz = -project.depthM * 0.5 + w.offsetCm / 100;
      parts.push(
        `<line x1="${toX(x).toFixed(1)}" y1="${toY(cz - lenM * 0.5).toFixed(1)}" x2="${toX(x).toFixed(1)}" y2="${toY(
          cz + lenM * 0.5
        ).toFixed(1)}" stroke="#0284c7" stroke-width="5"/>`
      );
    }
  }

  // Placed furniture footprints (skip ceiling lights so plan stays uncluttered)
  const planObjs = (project.objects || []).filter((o) => o.mountMode !== 'ceiling');
  planObjs.forEach((obj, idx) => {
    const px = toX(obj.x);
    const py = toY(obj.z);
    const fw = Math.max(10, obj.widthM * scale);
    const fd = Math.max(8, obj.depthM * scale);
    const deg = ((-obj.rot * 180) / Math.PI).toFixed(1);
    const isRug = obj.mountMode === 'rug';
    const fill = isRug ? '#f5f5f4' : '#e7e5e4';
    const stroke = isRug ? '#a8a29e' : '#44403c';
    const dash = isRug ? ' stroke-dasharray="4 3"' : '';
    parts.push(
      `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${deg})">` +
        `<rect x="${(-fw * 0.5).toFixed(1)}" y="${(-fd * 0.5).toFixed(1)}" width="${fw.toFixed(1)}" height="${fd.toFixed(
          1
        )}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${dash}/>` +
        `${
          !isRug
            ? `<text x="0" y="3.5" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8.5" font-weight="700" fill="#1c1917">${String(
                idx + 1
              ).padStart(2, '0')}</text>`
            : ''
        }` +
        `</g>`
    );
  });

  // North indicator
  parts.push(
    `<g transform="translate(${vbW - 34} 32)">` +
      `<circle cx="0" cy="0" r="14" fill="#ffffff" stroke="#1c1917" stroke-width="1.2"/>` +
      `<text x="0" y="4" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" font-weight="700" fill="#1c1917">K</text>` +
      `</g>`
  );
  parts.push('</svg>');
  return parts.join('');
}

export const ClientReportModal: React.FC<ClientReportModalProps> = ({
  open,
  project,
  clientName,
  latestRenderDataUrl,
  onCaptureViewport,
  onClose,
  onToast,
}) => {
  const [snap3dUrl, setSnap3dUrl] = useState<string | null>(null);
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const snap = onCaptureViewport();
    setSnap3dUrl(snap);
  }, [open, onCaptureViewport]);

  const arShareUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/#katalog`;
    }
    return 'https://mobilya-ar.vercel.app/#katalog';
  }, []);

  const rooms = useMemo<RoomMetrajRow[]>(() => {
    const mainWinArea = (project.windows || []).reduce((s, w) => s + (w.widthCm * w.heightCm) / 10000, 0);
    const mainDoorArea = (project.doors || []).reduce((s, d) => s + (d.widthCm * d.heightCm) / 10000, 0);
    const mainGrossWall = 2 * (project.widthM + project.depthM) * project.ceilingM;
    const mainWallNet = Math.max(4, mainGrossWall - mainWinArea - mainDoorArea);

    const rows: RoomMetrajRow[] = [
      {
        no: '01',
        id: 'main',
        name: 'Ana Salon',
        widthM: project.widthM,
        depthM: project.depthM,
        floorM2: project.widthM * project.depthM,
        wallNetM2: mainWallNet,
        floorLabel: FLOOR_MATERIAL_LABELS[project.floorMaterial as FloorMaterialKind]?.label || project.floorMaterial,
        floorHex: project.floorTintHex || '#cbb392',
        wallLabel: WALL_PATTERN_LABELS[project.walls.north.pattern as WallPattern] || 'Düz Mat Boya',
        wallHex: project.walls.north.colorHex || '#ecebe7',
        cx: 0,
        cz: 0,
      },
    ];

    (project.adjacentRooms || []).forEach((r, idx) => {
      const gross = 2 * (r.widthM + r.depthM) * project.ceilingM;
      const net = Math.max(3, gross - 2.1); // subtract approx doorway opening
      rows.push({
        no: String(idx + 2).padStart(2, '0'),
        id: r.id,
        name: r.name,
        widthM: r.widthM,
        depthM: r.depthM,
        floorM2: r.widthM * r.depthM,
        wallNetM2: net,
        floorLabel: FLOOR_MATERIAL_LABELS[r.floorMaterial as FloorMaterialKind]?.label || r.floorMaterial,
        floorHex: r.floorTintHex || '#cbb392',
        wallLabel: WALL_PATTERN_LABELS[r.wallPattern as WallPattern] || 'Düz Mat Boya',
        wallHex: r.wallColorHex || '#ecebe7',
        cx: r.centerXM,
        cz: r.centerZM,
      });
    });
    return rows;
  }, [project]);

  const totals = useMemo(() => {
    const floorM2 = rooms.reduce((s, r) => s + r.floorM2, 0);
    const wallNetM2 = rooms.reduce((s, r) => s + r.wallNetM2, 0);
    // Estimate paint liters (~1 L covers ~9 m² per coat, 2 coats = wallNetM2 / 4.5)
    const paintLiters = Math.max(2, Math.ceil(wallNetM2 / 4.5));
    // Estimate parquet with 10% cutting waste
    const parquetOrderM2 = Number((floorM2 * 1.1).toFixed(1));
    return { floorM2, wallNetM2, paintLiters, parquetOrderM2 };
  }, [rooms]);

  const floorPlanSvg = useMemo(() => buildFloorPlanSvgString(project, rooms), [project, rooms]);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    []
  );

  const projectTitle = clientName
    ? `${clientName} · ${project.projectName || 'Mimari Tasarım'}`
    : project.projectName || 'Mimari Tasarım Projesi';

  const buildStandaloneHtml = () => {
    const qrSvgHtml = qrWrapRef.current?.querySelector('svg')?.outerHTML || '';
    const roomRowsHtml = rooms
      .map(
        (r) => `
        <tr>
          <td style="font-family:monospace;color:#78716c;">${escapeHtml(r.no)}</td>
          <td style="font-weight:700;">${escapeHtml(r.name)}</td>
          <td style="font-family:monospace;">${r.widthM.toFixed(1)} × ${r.depthM.toFixed(1)} m</td>
          <td style="font-family:monospace;font-weight:700;">${r.floorM2.toFixed(1)} m²</td>
          <td style="font-family:monospace;font-weight:700;">${r.wallNetM2.toFixed(1)} m²</td>
          <td><span style="display:inline-block;width:10px;height:10px;border:1px solid #a8a29e;background:${escapeHtml(
            r.floorHex
          )};vertical-align:middle;margin-right:5px;"></span>${escapeHtml(r.floorLabel)}</td>
          <td><span style="display:inline-block;width:10px;height:10px;border:1px solid #a8a29e;background:${escapeHtml(
            r.wallHex
          )};vertical-align:middle;margin-right:5px;"></span>${escapeHtml(r.wallLabel)} (${escapeHtml(
          r.wallHex.toUpperCase()
        )})</td>
        </tr>`
      )
      .join('');

    const itemRowsHtml = (project.objects || [])
      .map(
        (o, idx) => `
        <tr>
          <td style="font-family:monospace;color:#78716c;">${String(idx + 1).padStart(2, '0')}</td>
          <td style="font-weight:600;">${escapeHtml(o.name)}</td>
          <td>${escapeHtml(o.category || 'Mobilya')}</td>
          <td>${escapeHtml(resolveRoomForObject(o, rooms))}</td>
          <td style="font-family:monospace;">${Math.round(o.widthM * 100)} × ${Math.round(o.depthM * 100)} × ${Math.round(
          o.heightM * 100
        )} cm</td>
          <td>${o.glbUrl ? 'Yüksek Detay 3B' : 'Mimari 3B'}</td>
        </tr>`
      )
      .join('');

    const visualsHtml = latestRenderDataUrl
      ? `<div style="display:grid;grid-template-columns:1.35fr 1fr;gap:12px;margin-top:12px;">
          <div style="border:1px solid #d6d3d1;background:#faf9f6;">
            <img src="${latestRenderDataUrl}" alt="V-Ray Render" style="width:100%;height:265px;object-fit:cover;display:block;"/>
            <div style="padding:6px 10px;font-size:10px;font-family:monospace;color:#57534e;border-top:1px solid #e7e5e4;">01 · V-RAY FOTOGERÇEKÇİ RENDER</div>
          </div>
          ${
            snap3dUrl
              ? `<div style="border:1px solid #d6d3d1;background:#faf9f6;">
                  <img src="${snap3dUrl}" alt="3B Sahne" style="width:100%;height:265px;object-fit:cover;display:block;"/>
                  <div style="padding:6px 10px;font-size:10px;font-family:monospace;color:#57534e;border-top:1px solid #e7e5e4;">02 · CANLI 3B MİMARİ SAHNE</div>
                </div>`
              : ''
          }
        </div>`
      : snap3dUrl
      ? `<div style="border:1px solid #d6d3d1;background:#faf9f6;margin-top:12px;">
          <img src="${snap3dUrl}" alt="3B Sahne" style="width:100%;max-height:320px;object-fit:cover;display:block;"/>
          <div style="padding:6px 10px;font-size:10px;font-family:monospace;color:#57534e;border-top:1px solid #e7e5e4;">01 · CANLI 3B MİMARİ SAHNE</div>
        </div>`
      : '';

    return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(projectTitle)} — MekanAR Müşteri Sunumu</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; color: #1c1917; background: #f5f5f4; line-height: 1.45; }
  .sheet { max-width: 820px; margin: 20px auto; background: #ffffff; border: 1px solid #d6d3d1; padding: 28px 32px; }
  .topbar { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #1c1917; padding-bottom:14px; gap:16px; }
  h1 { margin:4px 0 0; font-size:22px; letter-spacing:-0.02em; }
  h2 { margin:22px 0 8px; font-size:12px; font-family:ui-monospace,monospace; text-transform:uppercase; letter-spacing:0.12em; color:#57534e; border-bottom:1px solid #e7e5e4; padding-bottom:5px; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); border-top:1px solid #d6d3d1; border-left:1px solid #d6d3d1; margin-top:14px; }
  .kpi { padding:10px 12px; border-right:1px solid #d6d3d1; border-bottom:1px solid #d6d3d1; background:#faf9f6; }
  .kpi .lbl { font-size:10px; color:#78716c; text-transform:uppercase; font-family:ui-monospace,monospace; }
  .kpi .val { font-size:16px; font-weight:800; margin-top:2px; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-top:6px; }
  th { text-align:left; font-size:10px; text-transform:uppercase; font-family:ui-monospace,monospace; color:#57534e; background:#faf9f6; border:1px solid #d6d3d1; padding:7px 8px; }
  td { border:1px solid #e7e5e4; padding:7px 8px; vertical-align:middle; }
  .footer { margin-top:22px; padding-top:14px; border-top:1px solid #d6d3d1; display:flex; justify-content:space-between; align-items:center; gap:16px; }
  .print-bar { max-width:820px; margin:16px auto 0; display:flex; justify-content:flex-end; gap:8px; }
  .print-btn { background:#1c1917; color:#fff; border:none; padding:10px 18px; font-size:12px; font-weight:700; cursor:pointer; }
  @media print {
    body { background: #ffffff; }
    .print-bar { display: none !important; }
    .sheet { margin: 0; border: none; padding: 0; max-width: none; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">PDF Olarak Kaydet / Yazdır</button>
  </div>
  <div class="sheet">
    <div class="topbar">
      <div>
        <div style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#78716c;">MEKANAR · MİMARİ SUNUM &amp; METRAJ RAPORU</div>
        <h1>${escapeHtml(projectTitle)}</h1>
      </div>
      <div style="text-align:right;font-size:11px;color:#57534e;">
        <div><strong>Tarih:</strong> ${escapeHtml(dateLabel)}</div>
        <div><strong>Tavan Yüksekliği:</strong> ${(project.ceilingM * 100).toFixed(0)} cm</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="lbl">Toplam Alan</div><div class="val">${totals.floorM2.toFixed(1)} m²</div></div>
      <div class="kpi"><div class="lbl">Oda Sayısı</div><div class="val">${rooms.length} Oda</div></div>
      <div class="kpi"><div class="lbl">Tahmini Parke (+%10)</div><div class="val">${totals.parquetOrderM2} m²</div></div>
      <div class="kpi"><div class="lbl">Net Boya / Tahmini</div><div class="val">${totals.wallNetM2.toFixed(0)} m² (~${totals.paintLiters} L)</div></div>
    </div>

    ${visualsHtml}

    <h2>01 / Ölçülü 2D Mimari Kroki</h2>
    ${floorPlanSvg}

    <h2>02 / Oda Bazlı Metraj &amp; Malzeme Özeti</h2>
    <table>
      <thead>
        <tr>
          <th>No</th><th>Oda</th><th>Ölçü</th><th>Zemin</th><th>Net Duvar</th><th>Zemin Malzemesi</th><th>Duvar Kaplama / Boya</th>
        </tr>
      </thead>
      <tbody>${roomRowsHtml}</tbody>
    </table>

    <h2>03 / Mobilya &amp; Aksesuar Ölçü Listesi (${project.objects.length} Parça)</h2>
    <table>
      <thead>
        <tr>
          <th>No</th><th>Eşya Adı</th><th>Kategori</th><th>Oda</th><th>Ölçüler (En × Der × Yük)</th><th>Model</th>
        </tr>
      </thead>
      <tbody>${itemRowsHtml || '<tr><td colspan="6" style="text-align:center;color:#78716c;">Henüz mobilya eklenmedi.</td></tr>'}</tbody>
    </table>

    <div class="footer">
      <div style="font-size:11px;color:#57534e;max-width:520px;">
        <div style="font-weight:700;color:#1c1917;margin-bottom:3px;">MekanAR Canlı 1:1 AR &amp; Mimari 3B Stüdyo</div>
        <div>Bu rapor, gerçek santimetre ölçekli 3B mimari sahneden otomatik hesaplanmıştır. Yan taraftaki QR kodu telefon kamerasıyla okutarak mobilyaları kendi odanızda 1:1 canlı AR olarak inceleyebilirsiniz.</div>
      </div>
      <div style="text-align:center;border:1px solid #d6d3d1;padding:8px;background:#ffffff;">
        ${qrSvgHtml}
        <div style="font-size:9px;font-family:ui-monospace,monospace;margin-top:4px;color:#57534e;">TELEFONDA AR İLE GÖR</div>
      </div>
    </div>
  </div>
</body>
</html>`;
  };

  const handlePrintPdf = () => {
    const html = buildStandaloneHtml();
    const w = window.open('', '_blank', 'width=940,height=920');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => {
        try {
          w.print();
        } catch {
          /* user can click print button inside opened window */
        }
      }, 450);
      onToast('A4 PDF yazdırma ekranı açıldı — hedef olarak "PDF olarak kaydet" seçebilirsiniz.');
    } else {
      handleDownloadHtml();
      onToast('Tarayıcı yeni pencereyi engelledi; offline sunum dosyası indirildi.');
    }
  };

  const handleDownloadHtml = () => {
    const html = buildStandaloneHtml();
    const slug = (projectTitle || 'mekanar-sunum')
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'mekanar'}-Musteri-Sunumu.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    onToast('Offline Müşteri Sunumu (.HTML) indirildi — WhatsApp veya e-posta ile paylaşabilirsiniz.');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-5">
      <div className="w-full max-w-5xl max-h-[94dvh] bg-white border border-stone-300 shadow-2xl flex flex-col overflow-hidden">
        {/* Clean Executive Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-stone-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-stone-950 text-white flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-stone-500">
                MekanAR · Müşteri Sunumu &amp; Otomatik Metraj
              </p>
              <h2 className="text-sm sm:text-base font-bold text-stone-950 truncate">{projectTitle}</h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="px-3 py-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Paylaşım Dosyası (.HTML)</span>
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="px-4 py-2 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>PDF Kaydet / Yazdır</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 border border-stone-200 hover:border-stone-950 text-stone-700 hover:text-stone-950 transition"
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Live A4 Architectural Sheet Preview */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-[#eceae4] p-3 sm:p-6">
          <div className="max-w-[820px] mx-auto bg-white border border-stone-300 shadow-sm p-5 sm:p-8 space-y-6">
            {/* Sheet Title & Date */}
            <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b-2 border-stone-950">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-stone-500">
                  MİMARİ SUNUM &amp; METRAJ ÖZETİ
                </p>
                <h3 className="text-xl font-extrabold text-stone-950 tracking-tight mt-0.5">{projectTitle}</h3>
              </div>
              <div className="text-right text-xs text-stone-600 space-y-0.5">
                <p>
                  <strong className="text-stone-900">Tarih:</strong> {dateLabel}
                </p>
                <p>
                  <strong className="text-stone-900">Tavan Yüksekliği:</strong> {Math.round(project.ceilingM * 100)} cm
                </p>
              </div>
            </div>

            {/* 4 Architectural KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-l border-stone-300 bg-[#faf9f6]">
              <div className="p-3 border-r border-b border-stone-300">
                <p className="text-[10px] font-mono uppercase text-stone-500">Toplam Alan</p>
                <p className="text-lg font-extrabold text-stone-950">{totals.floorM2.toFixed(1)} m²</p>
              </div>
              <div className="p-3 border-r border-b border-stone-300">
                <p className="text-[10px] font-mono uppercase text-stone-500">Oda Sayısı</p>
                <p className="text-lg font-extrabold text-stone-950">{rooms.length} Oda</p>
              </div>
              <div className="p-3 border-r border-b border-stone-300">
                <p className="text-[10px] font-mono uppercase text-stone-500">Parke Sipariş (+%10)</p>
                <p className="text-lg font-extrabold text-stone-950">{totals.parquetOrderM2} m²</p>
              </div>
              <div className="p-3 border-r border-b border-stone-300">
                <p className="text-[10px] font-mono uppercase text-stone-500">Net Boya Alanı</p>
                <p className="text-lg font-extrabold text-stone-950">
                  {totals.wallNetM2.toFixed(0)} m²{' '}
                  <span className="text-xs font-mono font-normal text-stone-500">(~{totals.paintLiters} L)</span>
                </p>
              </div>
            </div>

            {/* Visual Showcase: V-Ray Render + 3B Scene */}
            {(latestRenderDataUrl || snap3dUrl) && (
              <div className={`grid grid-cols-1 ${latestRenderDataUrl && snap3dUrl ? 'sm:grid-cols-12' : ''} gap-3`}>
                {latestRenderDataUrl && (
                  <div className={`${snap3dUrl ? 'sm:col-span-7' : ''} border border-stone-300 bg-[#faf9f6]`}>
                    <img
                      src={latestRenderDataUrl}
                      alt="V-Ray Fotogerçekçi Render"
                      className="w-full h-56 sm:h-64 object-cover block"
                    />
                    <p className="px-3 py-1.5 text-[10px] font-mono uppercase text-stone-600 border-t border-stone-200">
                      01 · V-Ray Fotogerçekçi Render
                    </p>
                  </div>
                )}
                {snap3dUrl && (
                  <div className={`${latestRenderDataUrl ? 'sm:col-span-5' : ''} border border-stone-300 bg-[#faf9f6]`}>
                    <img
                      src={snap3dUrl}
                      alt="3B Mimari Sahne"
                      className="w-full h-56 sm:h-64 object-cover block"
                    />
                    <p className="px-3 py-1.5 text-[10px] font-mono uppercase text-stone-600 border-t border-stone-200">
                      {latestRenderDataUrl ? '02' : '01'} · Canlı 3B Mimari Sahne
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 01 · Scaled 2D Floor Plan SVG */}
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-stone-500 border-b border-stone-200 pb-1">
                01 / Ölçülü 2D Mimari Kroki
              </p>
              <div dangerouslySetInnerHTML={{ __html: floorPlanSvg }} />
            </div>

            {/* 02 · Per-Room Metraj Table */}
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-stone-500 border-b border-stone-200 pb-1">
                02 / Oda Bazlı Metraj &amp; Malzeme Özeti
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#faf9f6] text-[10px] font-mono uppercase text-stone-600">
                      <th className="border border-stone-300 px-2.5 py-2 text-left">No</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Oda</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Ölçü</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Zemin</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Net Duvar</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Zemin Malzemesi</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Duvar Boyası</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.id} className="text-stone-800">
                        <td className="border border-stone-200 px-2.5 py-2 font-mono text-stone-500">{r.no}</td>
                        <td className="border border-stone-200 px-2.5 py-2 font-bold text-stone-950">{r.name}</td>
                        <td className="border border-stone-200 px-2.5 py-2 font-mono whitespace-nowrap">
                          {r.widthM.toFixed(1)}×{r.depthM.toFixed(1)} m
                        </td>
                        <td className="border border-stone-200 px-2.5 py-2 font-mono font-bold whitespace-nowrap">
                          {r.floorM2.toFixed(1)} m²
                        </td>
                        <td className="border border-stone-200 px-2.5 py-2 font-mono font-bold whitespace-nowrap">
                          {r.wallNetM2.toFixed(1)} m²
                        </td>
                        <td className="border border-stone-200 px-2.5 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 border border-black/20 shrink-0" style={{ backgroundColor: r.floorHex }} />
                            <span>{r.floorLabel}</span>
                          </span>
                        </td>
                        <td className="border border-stone-200 px-2.5 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 border border-black/20 shrink-0" style={{ backgroundColor: r.wallHex }} />
                            <span>
                              {r.wallLabel} <span className="font-mono text-[10px] text-stone-500">{r.wallHex.toUpperCase()}</span>
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 03 · Numbered Furniture & Measurements Table */}
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-stone-500 border-b border-stone-200 pb-1">
                03 / Mobilya &amp; Aksesuar Listesi ({project.objects.length} Parça)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#faf9f6] text-[10px] font-mono uppercase text-stone-600">
                      <th className="border border-stone-300 px-2.5 py-2 text-left">No</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Eşya Adı</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Kategori</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Oda</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Ölçüler (En × Der × Yük)</th>
                      <th className="border border-stone-300 px-2.5 py-2 text-left">Detay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.objects.length > 0 ? (
                      project.objects.map((o, idx) => (
                        <tr key={o.id} className="text-stone-800">
                          <td className="border border-stone-200 px-2.5 py-1.5 font-mono text-stone-500">
                            {String(idx + 1).padStart(2, '0')}
                          </td>
                          <td className="border border-stone-200 px-2.5 py-1.5 font-semibold text-stone-950">{o.name}</td>
                          <td className="border border-stone-200 px-2.5 py-1.5 text-stone-600">{o.category || 'Mobilya'}</td>
                          <td className="border border-stone-200 px-2.5 py-1.5 text-stone-600">
                            {resolveRoomForObject(o, rooms)}
                          </td>
                          <td className="border border-stone-200 px-2.5 py-1.5 font-mono whitespace-nowrap">
                            {Math.round(o.widthM * 100)} × {Math.round(o.depthM * 100)} × {Math.round(o.heightM * 100)} cm
                          </td>
                          <td className="border border-stone-200 px-2.5 py-1.5 text-[11px] text-stone-600">
                            {o.glbUrl ? 'Yüksek Detay 3B' : 'Mimari 3B'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="border border-stone-200 px-3 py-4 text-center text-stone-500">
                          Henüz mobilya eklenmedi.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer with Live QR Code */}
            <div className="pt-4 border-t border-stone-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-lg">
                <p className="text-xs font-bold text-stone-950 flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5" />
                  <span>MekanAR Canlı 1:1 AR &amp; Mimari Sunum</span>
                </p>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  Tüm metrajlar odanın santimetre ölçekli 3B planından otomatik hesaplanmıştır. Sağdaki QR kodu
                  telefon kamerasıyla okutarak ürünleri gerçek odanızda 1:1 canlı AR ile görebilirsiniz.
                </p>
              </div>
              <div ref={qrWrapRef} className="p-2.5 border border-stone-300 bg-white text-center shrink-0">
                <QRCodeSVG value={arShareUrl} size={76} bgColor="#ffffff" fgColor="#1c1917" level="M" />
                <p className="text-[9px] font-mono text-stone-500 mt-1">TELEFONDA AR</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
