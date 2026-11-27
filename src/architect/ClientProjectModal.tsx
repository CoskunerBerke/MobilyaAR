import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import type { ApartmentPresetId } from './multiRoomTemplates';
import { formatRelativeTimeTr, type ClientProjectRecord } from './clientProjects';

interface Props {
  open: boolean;
  clients: ClientProjectRecord[];
  activeClientId: string | null;
  hasUnsavedWork: boolean;
  onClose: () => void;
  onSelectClient: (client: ClientProjectRecord) => void;
  onCreateClient: (opts: {
    clientName: string;
    roomTitle: string;
    phone?: string;
    note?: string;
    preset: ApartmentPresetId | 'keep_current';
  }) => void;
  onRenameClient: (id: string, clientName: string, roomTitle: string, phone?: string, note?: string) => void;
  onDuplicateClient: (id: string) => void;
  onDeleteClient: (id: string) => void;
}

export const ClientProjectModal: React.FC<Props> = ({
  open,
  clients,
  activeClientId,
  hasUnsavedWork,
  onClose,
  onSelectClient,
  onCreateClient,
  onRenameClient,
  onDuplicateClient,
  onDeleteClient,
}) => {
  const [search, setSearch] = useState('');
  const [clientName, setClientName] = useState('');
  const [roomTitle, setRoomTitle] = useState('Salon');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [preset, setPreset] = useState<ApartmentPresetId | 'keep_current'>(
    hasUnsavedWork ? 'keep_current' : 'single'
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRoom, setEditRoom] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return clients;
    return clients.filter((c) => {
      const hay = `${c.clientName} ${c.roomTitle} ${c.phone || ''} ${c.note || ''}`.toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
  }, [clients, search]);

  if (!open) return null;

  const handleSubmitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;
    onCreateClient({
      clientName: clientName.trim(),
      roomTitle: roomTitle.trim() || (preset === 'single' || preset === 'keep_current' ? 'Salon' : `${preset} Daire`),
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
      preset,
    });
    setClientName('');
    setPhone('');
    setNote('');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90dvh] bg-white border border-stone-300 shadow-2xl flex flex-col overflow-hidden text-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Clean Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-stone-200 bg-[#faf9f6] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              MekanAR · Müşteri Proje Yönetimi
            </p>
            <h2 className="font-display text-base sm:text-lg font-extrabold text-stone-950 truncate">
              Hangi Müşterinin Odasına Girmek İstiyorsunuz?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-700 hover:text-stone-950 shrink-0 transition"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2-Column Content */}
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-stone-200">
          {/* Left: Create New Customer Room */}
          <form onSubmit={handleSubmitNew} className="md:col-span-5 p-4 sm:p-5 space-y-3.5 bg-white">
            <div className="flex items-center gap-2 pb-1 border-b border-stone-100">
              <UserPlus className="w-4 h-4 text-stone-800 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-900">
                Yeni Müşteri Odası Aç
              </span>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-stone-700 block">
                Müşteri Adı Soyadı <span className="text-red-600">*</span>
              </span>
              <input
                type="text"
                required
                autoFocus={clients.length === 0}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Örn: Ahmet Yılmaz"
                className="w-full px-3 py-2 border border-stone-300 bg-[#faf9f6] text-xs text-stone-950 placeholder:text-stone-400 focus:border-stone-950 focus:bg-white focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-stone-700 block">Oda / Proje Adı</span>
                <input
                  type="text"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  placeholder="Salon, 3+1 Ev..."
                  className="w-full px-2.5 py-2 border border-stone-300 bg-[#faf9f6] text-xs text-stone-950 focus:border-stone-950 focus:bg-white focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-stone-700 block">Telefon (Opsiyonel)</span>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="05XX XXX XX XX"
                  className="w-full px-2.5 py-2 border border-stone-300 bg-[#faf9f6] text-xs text-stone-950 focus:border-stone-950 focus:bg-white focus:outline-none"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-stone-700 block">Kısa Not (Opsiyonel)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Örn: Kadıköy daire · açık meşe ve keten istiyor"
                className="w-full px-3 py-2 border border-stone-300 bg-[#faf9f6] text-xs text-stone-950 focus:border-stone-950 focus:bg-white focus:outline-none"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-stone-700 block">Başlangıç Planı</span>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'single' as ApartmentPresetId, lbl: 'Tek Oda' },
                    { id: '1+1' as ApartmentPresetId, lbl: '1+1' },
                    { id: '2+1' as ApartmentPresetId, lbl: '2+1' },
                    { id: '3+1' as ApartmentPresetId, lbl: '3+1' },
                  ]
                ).map((pr) => (
                  <button
                    key={pr.id}
                    type="button"
                    onClick={() => {
                      setPreset(pr.id);
                      if (pr.id === 'single' && /1\+1|2\+1|3\+1/.test(roomTitle)) setRoomTitle('Salon');
                      else if (pr.id !== 'single' && (!roomTitle || roomTitle === 'Salon' || /1\+1|2\+1|3\+1/.test(roomTitle))) {
                        setRoomTitle(`${pr.id} Daire`);
                      }
                    }}
                    className={`py-1.5 border text-[11px] font-semibold transition ${
                      preset === pr.id
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-300 bg-white text-stone-800 hover:border-stone-950'
                    }`}
                  >
                    {pr.lbl}
                  </button>
                ))}
              </div>
              {hasUnsavedWork && (
                <button
                  type="button"
                  onClick={() => setPreset('keep_current')}
                  className={`w-full py-1.5 px-2 border text-[11px] font-semibold transition ${
                    preset === 'keep_current'
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-300 bg-[#faf9f6] text-stone-800 hover:border-stone-950'
                  }`}
                >
                  Ekrandaki Mevcut Odayı Bu Müşteriye Kaydet
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={!clientName.trim()}
              className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 disabled:opacity-45 text-white text-xs font-bold flex items-center justify-center gap-2 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Müşteri Odasını Aç &amp; Otomatik Kaydet</span>
            </button>

            <p className="text-[10px] text-stone-500 leading-snug">
              Yapılan tüm ölçü, duvar, parke ve mobilya değişiklikleri bu müşterinin dosyasına otomatik kaydedilir.
            </p>
          </form>

          {/* Right: Saved Clients List */}
          <div className="md:col-span-7 p-4 sm:p-5 bg-[#faf9f6] flex flex-col min-h-[260px] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-stone-800 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider text-stone-900">
                  Kayıtlı Müşteriler ({clients.length})
                </span>
              </div>
              {activeClientId && (
                <span className="text-[10px] font-mono text-emerald-700 font-semibold">
                  ● Otomatik Kayıt Aktif
                </span>
              )}
            </div>

            {clients.length > 0 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Müşteri adı, oda, telefon veya not ara..."
                  className="w-full pl-8 pr-7 py-2 border border-stone-300 bg-white text-xs focus:border-stone-950 focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-950"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {clients.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-stone-300 bg-white p-6 space-y-2">
                <User className="w-6 h-6 text-stone-400" />
                <p className="text-xs font-semibold text-stone-800">Henüz kayıtlı müşteri odası yok</p>
                <p className="text-[11px] text-stone-500 max-w-xs leading-relaxed">
                  Soldan ilk müşterinizin adını yazıp odasını açın — bir sonraki girişinizde tüm müşterileriniz burada tek tıkla listelenecek.
                </p>
              </div>
            ) : filteredClients.length === 0 ? (
              <div className="py-10 text-center text-xs text-stone-500 border border-stone-200 bg-white">
                &ldquo;{search}&rdquo; ile eşleşen müşteri bulunamadı.
              </div>
            ) : (
              <div className="space-y-2 max-h-[50dvh] overflow-y-auto pr-0.5">
                {filteredClients.map((c, idx) => {
                  const isActive = c.id === activeClientId;
                  const isEditing = editingId === c.id;
                  const isConfirmDel = confirmDeleteId === c.id;

                  if (isEditing) {
                    return (
                      <div key={c.id} className="border border-stone-950 bg-white p-3 space-y-2 text-xs">
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Müşteri Adı"
                            className="px-2 py-1.5 border border-stone-300 text-xs font-semibold"
                          />
                          <input
                            type="text"
                            value={editRoom}
                            onChange={(e) => setEditRoom(e.target.value)}
                            placeholder="Oda Adı"
                            className="px-2 py-1.5 border border-stone-300 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            placeholder="Telefon"
                            className="px-2 py-1.5 border border-stone-300 text-xs"
                          />
                          <input
                            type="text"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Not"
                            className="px-2 py-1.5 border border-stone-300 text-xs"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 border border-stone-300 text-[11px] font-semibold"
                          >
                            İptal
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (editName.trim()) {
                                onRenameClient(c.id, editName.trim(), editRoom.trim() || 'Salon', editPhone.trim(), editNote.trim());
                              }
                              setEditingId(null);
                            }}
                            className="px-3 py-1 bg-stone-950 text-white text-[11px] font-semibold flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Kaydet
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={c.id}
                      className={`border transition bg-white ${
                        isActive ? 'border-stone-950 ring-1 ring-stone-950' : 'border-stone-200 hover:border-stone-600'
                      }`}
                    >
                      <div className="p-3 flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectClient(c)}
                          className="flex-1 min-w-0 text-left space-y-1"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[10px] text-stone-400 shrink-0">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="font-bold text-stone-950 text-xs sm:text-sm truncate">
                              {c.clientName}
                            </span>
                            <span className="text-[11px] text-stone-500 truncate">· {c.roomTitle}</span>
                            {isActive && (
                              <span className="px-1.5 py-0.5 bg-stone-950 text-white text-[9px] font-mono uppercase shrink-0">
                                Aktif
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-mono text-stone-500">
                            <span>{c.roomCount} Oda · {c.areaM2} m²</span>
                            <span>{c.objectCount} Eşya</span>
                            <span>{formatRelativeTimeTr(c.updatedAt)}</span>
                            {c.phone && <span className="text-stone-700">{c.phone}</span>}
                          </div>
                          {c.note && (
                            <p className="text-[11px] text-stone-600 truncate">{c.note}</p>
                          )}
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onSelectClient(c)}
                            className={`px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition ${
                              isActive
                                ? 'bg-stone-950 text-white'
                                : 'border border-stone-950 text-stone-950 hover:bg-stone-950 hover:text-white'
                            }`}
                          >
                            {isActive ? 'Devam Et' : 'Odaya Gir'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(c.id);
                              setEditName(c.clientName);
                              setEditRoom(c.roomTitle);
                              setEditPhone(c.phone || '');
                              setEditNote(c.note || '');
                            }}
                            className="p-1.5 border border-stone-200 hover:border-stone-950 text-stone-600 hover:text-stone-950"
                            title="Müşteri Bilgilerini Düzenle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicateClient(c.id)}
                            className="p-1.5 border border-stone-200 hover:border-stone-950 text-stone-600 hover:text-stone-950"
                            title="Alternatif Olarak Kopyala"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {isConfirmDel ? (
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteClient(c.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1.5 bg-red-600 text-white text-[10px] font-bold whitespace-nowrap"
                            >
                              Sil?
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(c.id)}
                              className="p-1.5 border border-stone-200 hover:border-red-600 text-stone-500 hover:text-red-600"
                              title="Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Clean Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-stone-200 bg-white flex items-center justify-between gap-2 shrink-0">
          <p className="text-[11px] text-stone-500 hidden sm:block">
            Üst menüdeki müşteri adından istediğiniz zaman başka bir müşterinin odasına geçebilirsiniz.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 border border-stone-300 hover:border-stone-950 text-xs font-semibold text-stone-700 hover:text-stone-950 transition"
          >
            {activeClientId ? 'Odaya Dön' : 'Müşteri Seçmeden Hızlı Dene'}
          </button>
        </div>
      </div>
    </div>
  );
};
