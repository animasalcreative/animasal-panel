// Animasal Pipeline — WEB PANELİ (14.11.2026). Gerçek Supabase'te DENENMEDİ.
// Giriş: Google (Supabase Auth, pkce) → google_bagla (kişiye bağlar) → web_ben (kim, rol, genel nöbet).
// Ekip: SADE ekran (kendi planları, acil, "Bugün geliyorum / gelemiyorum", genel nöbet açıksa "İşi al").
// Yönetim: Pano, İşler, Post prod, Mesajlar, Nöbet, Teslim tarihleri, Benim işlerim.
// OKUMA tablolardan (sunucudaki kurallar / RLS kimin neyi göreceğini belirler); YAZMA yalnızca web_* işlevleriyle
// (app/supabase/web-panel.sql; sunucu çağıranın rolünü denetler, JSON alanlarını masaüstüyle aynı biçimde yazar).
// config.js: window.AP_AYAR = { url, anahtar } (yap.mjs app/.env.local'dan yazar; yalnızca publishable anahtar).
/* global supabase */
'use strict'
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const sakla = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
const al = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const GUN = 24 * 3600e3

const sb = supabase.createClient(window.AP_AYAR.url, window.AP_AYAR.anahtar, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, storageKey: 'wp-oturum' }
})

// ---- sözlük ----
const DURUM_YAZI = { bekliyor: 'Bekliyor', calisiliyor: 'Çalışılıyor', bitti: 'Bitti', kontrolde: 'Kontrolde', revize: 'Revize', onay: 'Onaylandı', teslim: 'Teslim edildi', iptal: 'İptal' }
const DURUM_SECIM = ['bekliyor', 'calisiliyor', 'bitti', 'kontrolde', 'revize', 'onay', 'teslim']
const BITMIS = ['bitti', 'kontrolde', 'onay', 'teslim', 'iptal']
const ROL_YAZI = { yonetici1: 'Yönetici 1', yonetici2: 'Yönetici 2', ekip: 'Ekip' }
const NOBET_YETKILERI = [
  ['mesaj', 'Ekibe ekranın ortasında mesaj'],
  ['acil', 'Planı / projeyi acile çekme'],
  ['izin', 'Sıra dışı başlatma isteklerini yanıtlama'],
  ['atama', 'Planı başka kişiye verme'],
  ['durum', 'Plan durumunu değiştirme'],
  ['wetransfer', 'Gelen WeTransfer linkini dağıtma'],
  ['teslim', 'Bölümü / projeyi "Teslim edildi" işaretleme']
]
const NOBET_VARSAYILAN = ['mesaj', 'acil', 'izin', 'atama', 'wetransfer']
const PP_TUR = { acil: 'Acil isteği', 'teslim-tarihi': 'Teslim tarihi isteği', karar: 'Karar', 'kalanlari-onayla': 'Kalanları onayla', link: 'Link' }
const PP_KARAR = { ok: 'onayladı', rev: 'revizeye aldı', eks: 'eksik bildirdi' }

// sunucu hata kodları → basit Türkçe
const HATALAR = [
  ['Could not find the function', 'Sunucuda web paneli kurulmamış (web-panel.sql çalıştırılmalı).'],
  ['schema cache', 'Sunucuda web paneli kurulmamış (web-panel.sql çalıştırılmalı).'],
  ['yalnizca yonetim', 'Bunu yalnızca yönetim yapabilir.'],
  ['uye degil', 'Hesabın ekipte bağlı değil.'],
  ['genel nobet acik degil', 'Genel nöbet şu an kapalı.'],
  ['genel nobete giremezsin', 'Genel nöbete girme iznin yok.'],
  ['bu plan alinamaz', 'Bu plan alınamaz: başlanmış ya da başkasına verilmiş.'],
  ['plan yok', 'Plan bulunamadı (silinmiş olabilir).'],
  ['proje yok', 'Proje bulunamadı.'],
  ['kisi yok', 'Kişi bulunamadı ya da pasif.'],
  ['iptal edilmis plan', 'İptal edilmiş plan webde değiştirilmez.'],
  ['planda revize yok', 'Bu planda revize yok.'],
  ['mesaj bos', 'Mesaj boş.'],
  ['karsi oneri metni bos', 'Karşı öneriyi yaz.'],
  ['tarih bicimi', 'Tarih biçimi yanlış.'],
  ['gecersiz', 'Geçersiz seçim.'],
  ['Failed to fetch', 'İnternet bağlantısı yok gibi.']
]
const hataYazi = (m) => (HATALAR.find(([k]) => String(m || '').includes(k)) || [null, 'Olmadı: ' + m])[1]

// ---- durum ----
const D = {
  ben: null, sekme: al('wp-sekme') || 'pano', taslak: {}, mesgul: false, sonOrtak: 0, acik: new Set(),
  kisiler: [], kisiMap: new Map(), projeler: [], ayar: { nobetler: [], genelNobet: null },
  gorevler: null, gnPlanlar: [],
  saatler: null, panoPlan: new Map(), acilPlanlar: [],
  isP: al('wp-is-proje'), isB: al('wp-is-bolum'), isSuz: 'acik', planlar: null,
  ppIstek: null, ppMesaj: [], ppNo: new Map(), ppSohbet: null, ppSohbetListe: [], ppHedef: null, ppSayi: 0,
  kanal: al('wp-kanal') || 'genel', kanalMesaj: null,
  nbYetki: new Set(NOBET_VARSAYILAN)
}

// ---- küçük yardımcılar ----
function bildir(metin, hata = false) {
  const t = document.createElement('div')
  t.className = 'tost' + (hata ? ' hata' : '')
  t.textContent = metin
  $('#bildirim').appendChild(t)
  setTimeout(() => t.remove(), hata ? 4500 : 2200)
}
const kaydedildi = (metin) => bildir('✓ ' + metin)
const kisiAd = (id) => (id ? D.kisiMap.get(id)?.ad || 'Bilinmeyen kişi' : '—')
const bolumKisa = (no) => (no == null ? '' : 'BLM_' + String(no).padStart(2, '0'))
const projeBolum = (p, no) => `${p?.ad || ''}${no == null ? '' : ' ' + bolumKisa(no)}`
const projeBul = (pid) => D.projeler.find((p) => p.id === pid)
const kisaNo = (no) => String(no ?? '').split(' ')[0]
const p2 = (n) => String(n).padStart(2, '0')
const yerelIso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
const istanbulGunu = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
const noSirasi = (a, b) => String(a.veri?.no ?? a.no ?? '').localeCompare(String(b.veri?.no ?? b.no ?? ''), 'tr', { numeric: true })
function tarihAl(t) {
  if (!t) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3], 23, 59), gunluk: true }
  const d = new Date(t)
  return isNaN(d) ? null : { d, gunluk: false }
}
function tarihYaz(t) {
  const x = tarihAl(t)
  if (!x) return t ? esc(t) : '—'
  const o = { weekday: 'short', day: '2-digit', month: '2-digit' }
  if (!x.gunluk) Object.assign(o, { hour: '2-digit', minute: '2-digit' })
  return x.d.toLocaleString('tr-TR', o)
}
function sureYaz(ms) {
  const dk = Math.max(0, Math.floor(ms / 60000))
  if (dk < 60) return dk + ' dk'
  const sa = Math.floor(dk / 60)
  return sa + ' sa ' + (dk % 60) + ' dk'
}
function kalanYaz(t) {
  const x = tarihAl(t)
  if (!x) return ''
  const ms = x.d - Date.now()
  if (ms < 0) return '<span style="color:var(--rev);font-weight:700">geçti</span>'
  const gun = Math.floor(ms / GUN)
  if (gun === 0) return '<span style="color:var(--acil);font-weight:700">bugün</span>'
  return gun === 1 ? '<span style="color:var(--eks);font-weight:700">yarın</span>' : gun + ' gün kaldı'
}
// Plan satırı: kapalıyken tek satır (ACİL, no, durum, kısa açıklama, sağda ek bilgi); dokununca ayrıntı açılır.
// Açık satırlar D.acik'te tutulur, 30 sn'lik yenilemede kapanmaz.
function planSatiri({ anahtar, acil, iptal, no, durum, aciklama, sag = '', govde }) {
  return `<details class="plan satirli ${acil && !iptal ? 'acil' : ''} ${iptal ? 'iptal' : ''}" data-ac="${esc(anahtar)}" ${D.acik.has(anahtar) ? 'open' : ''}>
    <summary class="plan-satir">${acil && !iptal ? '<span class="acil-yazi">ACİL</span>' : ''}<span class="no">${esc(kisaNo(no))}</span>${durumRozet(durum)}<span class="kisa">${esc(aciklama || '')}</span>${sag ? `<span class="sag-bilgi">${sag}</span>` : ''}</summary>
    <div class="plan-govde">${govde}</div>
  </details>`
}
const durumRozet = (d) =>`<span class="durum d-${esc(d || 'bekliyor')}">${esc(DURUM_YAZI[d] || d || 'Bekliyor')}</span>`

async function rpc(ad, args = {}) {
  const r = await sb.rpc(ad, args)
  if (r.error) throw new Error(hataYazi(r.error.message))
  if (r.data && typeof r.data === 'object' && r.data.ok === false) throw new Error(r.data.hata || 'Olmadı.')
  return r.data
}
async function sec(sorgu) {
  const r = await sorgu
  if (r.error) throw new Error(hataYazi(r.error.message))
  return r.data || []
}

// ---- tema ----
function temaUygula() {
  const t = al('wp-tema') || ''
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}
const TEMA_YAZI = { '': 'Tema: otomatik', light: 'Tema: açık', dark: 'Tema: koyu' }

// ---- giriş ----
async function basla() {
  temaUygula()
  const { data } = await sb.auth.getSession()
  if (!data.session) return girisEkrani()
  if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname)
  const eposta = data.session.user?.email || ''
  const g = await sb.rpc('google_bagla')
  if (g.error) {
    const m = g.error.message || ''
    const yazi = /ortak hesap/.test(m) ? 'Ofisin ortak Google hesabıyla girilmez. Kendi Gmail adresinle gir.'
      : /pasif/.test(m) ? 'Hesabın pasif. Yönetimle konuş.'
      : /google hesabi degil/.test(m) ? 'Yalnızca Google ile girilir.'
      : 'Giriş doğrulanamadı: ' + hataYazi(m)
    await sb.auth.signOut()
    return girisEkrani(yazi)
  }
  if (!g.data) {
    await sb.auth.signOut()
    return girisEkrani(`${eposta} ekipte kayıtlı değil. Yönetim, Pipeline'da Ekip → kişi → Giriş yöntemleri'nden bu adresi bağlamalı.`)
  }
  try {
    D.ben = await rpc('web_ben')
  } catch (e) {
    return girisEkrani(e.message, true)
  }
  if (!D.ben) return girisEkrani('Hesabın ekipte bağlı değil ya da pasif.', true)
  const gecerli = ['pano', 'isler', 'pp', 'mesaj', 'nobet', 'teslim', 'benim']
  if (!D.ben.yonetim || !gecerli.includes(D.sekme)) D.sekme = D.ben.yonetim ? 'pano' : 'benim'
  await tazele(true)
  setInterval(() => { if (document.visibilityState === 'visible' && !D.mesgul) tazele() }, 30e3)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tazele() })
}
function girisEkrani(hata = '', cikis = false) {
  $('#kok').innerHTML = `<div class="dis"><div class="kart giris"><img src="ikon-192.png" alt=""><h1>Animasal Pipeline</h1>
    <p class="soluk">Ekipteki Google adresinle gir. Ekip kendi planlarını, yönetim panoyu görür.</p>
    ${hata ? `<div class="hata-kutu">${esc(hata)}</div>` : ''}
    <button class="btn ana genis" data-is="googleGiris">Google ile giriş</button>
    ${cikis ? '<button class="btn genis" data-is="cikis">Başka hesapla gir</button>' : ''}</div></div>`
}

// ---- veri yükleme ----
async function ortakYukle() {
  const [k, p, a] = await Promise.all([
    sec(sb.from('kullanicilar').select('id,veri')),
    sec(sb.from('projeler').select('id,veri')),
    sec(sb.from('ayarlar').select('anahtar,veri').in('anahtar', ['nobetler', 'genelNobet', '_sira']))
  ])
  const ayar = Object.fromEntries(a.map((r) => [r.anahtar, r.veri]))
  const sira = ayar._sira || {}
  const sirala = (liste, ids) => liste.sort((x, y) => ((ids || []).indexOf(x.id) + 1 || 1e9) - ((ids || []).indexOf(y.id) + 1 || 1e9))
  D.kisiler = sirala(k.map((r) => ({ ...r.veri, id: r.id })), sira.kullanicilar)
  D.kisiMap = new Map(D.kisiler.map((x) => [x.id, x]))
  D.projeler = sirala(p.map((r) => ({ ...r.veri, id: r.id })), sira.projeler).filter((x) => !x.arsiv)
  D.ayar = { nobetler: Array.isArray(ayar.nobetler) ? ayar.nobetler : [], genelNobet: ayar.genelNobet && typeof ayar.genelNobet === 'object' ? ayar.genelNobet : null }
  // post prod rozeti: kararınızı bekleyen istek + okunmamış mesaj
  const [i, m] = await Promise.all([
    sb.from('musteri_istekleri').select('id', { count: 'exact', head: true }).eq('durum', 'ortak'),
    sb.from('musteri_mesajlari').select('id', { count: 'exact', head: true }).eq('taraf', 'musteri').is('okundu_animasal', null)
  ])
  D.ppSayi = (i.count || 0) + (m.count || 0)
  // üst bildirim şeridi: bitmemiş acil planlar (açık projelerde)
  const acil = await sb.from('planlar').select('id,proje_id,durum:veri->>durum').eq('veri->>acil', 'true')
  D.acilSayi = (acil.data || []).filter((r) => !BITMIS.includes(r.durum) && projeBul(r.proje_id)).length
  // Görevlerim sekmesindeki sayı (yöneticinin kendi bitmemiş işleri)
  try { D.gorevler = await rpc('web_gorevlerim'); D.gorevSayi = (D.gorevler || []).length } catch { /* sekme açılınca yeniden denenir */ }
  D.sonOrtak = Date.now()
}

async function benimYukle() {
  D.ben = (await rpc('web_ben')) || D.ben
  D.gorevler = await rpc('web_gorevlerim')
  D.gorevSayi = (D.gorevler || []).length
  D.gnPlanlar = D.ben.genelNobet?.gecerli && D.ben.genelNobetIzni ? await rpc('web_genel_nobet_planlar') : []
}

async function panoYukle() {
  const once = new Date(Date.now() - 1.5 * GUN).toISOString()
  const [s, acil] = await Promise.all([
    sec(sb.from('saatler').select('id,kisi,veri').is('veri->>bit', null).gte('guncelleme', once)),
    sec(sb.from('planlar').select('id,proje_id,bolum_no,veri').eq('veri->>acil', 'true'))
  ])
  D.saatler = s.map((r) => ({ ...r.veri, id: r.id, kisi: r.kisi }))
  const ids = [...new Set(D.saatler.map((x) => x.planId).filter(Boolean))]
  const pl = ids.length ? await sec(sb.from('planlar').select('id,proje_id,bolum_no,veri').in('id', ids)) : []
  D.panoPlan = new Map(pl.map((r) => [r.id, r]))
  D.acilPlanlar = acil.filter((r) => !BITMIS.includes(r.veri.durum) && projeBul(r.proje_id)).sort(noSirasi)
}

async function islerYukle() {
  if (!D.projeler.some((p) => p.id === D.isP)) D.isP = D.projeler[0]?.id || null
  const p = projeBul(D.isP)
  if (!p) { D.planlar = []; return }
  const bolumler = Array.isArray(p.bolumler) ? p.bolumler : null
  if (bolumler) {
    if (!bolumler.some((b) => String(b.no) === String(D.isB))) {
      const acik = bolumler.filter((b) => b.durum !== 'teslim')
      D.isB = String((acik[acik.length - 1] || bolumler[bolumler.length - 1] || {}).no ?? '')
    }
  } else D.isB = ''
  let q = sb.from('planlar').select('id,proje_id,bolum_no,veri').eq('proje_id', p.id)
  q = D.isB === '' ? q.is('bolum_no', null) : q.eq('bolum_no', Number(D.isB))
  D.planlar = (await sec(q)).sort(noSirasi)
}

async function ppYukle() {
  const once = new Date(Date.now() - GUN).toISOString()
  const [ist, msj] = await Promise.all([
    sec(sb.from('musteri_istekleri').select('*').or(`durum.in.(ortak,karsi),zaman.gt.${once}`).order('zaman', { ascending: false }).limit(200)),
    sec(sb.from('musteri_mesajlari').select('*').or(`okundu_animasal.is.null,zaman.gt.${once}`).order('zaman', { ascending: false }).limit(300))
  ])
  D.ppIstek = ist
  D.ppMesaj = msj
  const ids = [...new Set([...ist, ...msj].map((x) => x.plan_id).filter((x) => x && !D.ppNo.has(x)))]
  if (ids.length) for (const r of await sec(sb.from('planlar').select('id,no:veri->>no').in('id', ids))) D.ppNo.set(r.id, r.no)
  if (D.ppSohbet) {
    const l = await sec(sb.from('musteri_mesajlari').select('*').eq('proje_id', D.ppSohbet).order('zaman', { ascending: false }).limit(300))
    D.ppSohbetListe = l.reverse()
  }
}

async function mesajYukle() {
  const l = await sec(sb.from('mesajlar').select('id,kanal,veri').eq('kanal', D.kanal).order('veri->>zaman', { ascending: false }).limit(80))
  D.kanalMesaj = l.map((r) => r.veri).filter(Boolean).reverse()
}

async function tazele(zorla = false) {
  if (!D.ben) return
  try {
    if (D.ben.yonetim && (zorla || Date.now() - D.sonOrtak > 60e3)) await ortakYukle()
    const s = D.sekme
    if (s === 'benim') await benimYukle()
    else if (s === 'pano') await panoYukle()
    else if (s === 'isler') await islerYukle()
    else if (s === 'pp') await ppYukle()
    else if (s === 'mesaj') await mesajYukle()
  } catch (e) {
    bildir(e.message, true)
  }
  ciz(zorla)
}

// ---- çizim ----
// Yazı kutusundayken (odak) kendiliğinden yenileme ekranı yeniden kurmaz; yazılanlar D.taslak'ta saklanır.
const odakta = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#kok').contains(a) }
function ciz(zorla = false) {
  if (!D.ben) return
  if (!zorla && odakta()) return
  const sekmeler = D.ben.yonetim
    ? [['pano', 'Pano'], ['benim', 'Görevlerim', D.gorevSayi], ['isler', 'İşler'], ['pp', 'Post prod', D.ppSayi], ['mesaj', 'Mesajlar'], ['nobet', 'Nöbet'], ['teslim', 'Teslim']]
    : []
  // Yönetimde en üstte her sekmede duran bildirim şeridi (dokununca ilgili sekme açılır)
  let serit = ''
  if (D.ben.yonetim) {
    const nl = yerelIso(new Date())
    const nobetSimdi = (D.ayar?.nobetler || []).filter((n) => !n.bitirildi && n.bas <= nl && nl < n.bit)
    const gn = D.ayar?.genelNobet
    const gnAcik = gn && gn.acik && (!gn.bitis || Date.parse(gn.bitis) > Date.now())
    const ogeler = []
    if (D.ppSayi) ogeler.push(`<button class="bildirim-oge uyari" data-is="sekme" data-k="pp">Post prod: ${D.ppSayi} bekliyor</button>`)
    if (D.acilSayi) ogeler.push(`<button class="bildirim-oge uyari" data-is="sekme" data-k="pano">${D.acilSayi} acil plan</button>`)
    if (nobetSimdi.length) ogeler.push(`<button class="bildirim-oge" data-is="sekme" data-k="nobet">☾ Nöbette: ${esc(nobetSimdi.map((n) => kisiAd(n.kisi)).join(', '))}</button>`)
    if (gnAcik) ogeler.push(`<button class="bildirim-oge" data-is="sekme" data-k="nobet">Genel nöbet açık</button>`)
    serit = `<div class="dis bildirim-serit">${ogeler.length ? ogeler.join('') : '<span class="bildirim-oge tamam">✓ Bekleyen bir şey yok</span>'}</div>`
  }
  const icerik = { benim: benimEkrani, pano: panoEkrani, isler: islerEkrani, pp: ppEkrani, mesaj: mesajEkrani, nobet: nobetEkrani, teslim: teslimEkrani }[D.sekme] || benimEkrani
  const kaydir = window.scrollY
  $('#kok').innerHTML = `
    <header class="ust"><div class="dis">
      <img class="logo" src="ikon-192.png" alt="">
      <div class="marka">Animasal<small>${esc(D.ben.ad || '')} · ${esc(ROL_YAZI[D.ben.rol] || D.ben.rol || '')}</small></div>
      <div class="sag">
        <button class="kucuk-btn" data-is="tema" title="${esc(TEMA_YAZI[al('wp-tema') || ''])}" aria-label="${esc(TEMA_YAZI[al('wp-tema') || ''])}">◐</button>
        <button class="kucuk-btn" data-is="cikis">Çıkış</button>
      </div></div>
      ${sekmeler.length ? `<div class="dis"><nav class="sekmeler" role="tablist">${sekmeler.map(([k, ad, n]) => `<button class="sekme" role="tab" aria-selected="${D.sekme === k}" data-is="sekme" data-k="${k}">${ad}${n ? `<span class="rozet">${n}</span>` : ''}</button>`).join('')}</nav></div>` : ''}
      ${serit}
    </header>
    <main class="dis">${icerik()}</main>`
  window.scrollTo(0, kaydir)
}
const taslak = (k, varsayilan = '') => D.taslak[k] ?? varsayilan

// ===== EKİP / Benim işlerim =====
function benimEkrani() {
  const ben = D.ben
  const bugun = istanbulGunu()
  const g = ben.gelis && ben.gelis.tarih === bugun ? ben.gelis : null
  let h = `<section class="kart"><h2>Bugün</h2>
    <div class="iki">
      <button class="btn ${g?.durum === 'geliyor' ? 'iyi secili' : ''}" data-is="gelis" data-d="geliyor">Bugün geliyorum</button>
      <button class="btn ${g?.durum === 'gelemiyorum' || g?.durum === 'gelemiyor' ? 'kotu secili' : ''}" data-is="gelis" data-d="gelemiyor">Bugün gelemiyorum</button>
    </div>
    <div class="alan" style="margin:10px 0 0"><span>Not (isteğe bağlı)</span><input type="text" maxlength="200" data-taslak="gelisNot" value="${esc(taslak('gelisNot', g?.not || ''))}" placeholder="Örnek: 11'de gelirim"></div>
    ${g ? `<p class="kucuk soluk" style="margin:6px 0 0">Bugün için seçimin: <b>${g.durum === 'geliyor' ? 'geliyorum' : 'gelemiyorum'}</b>${g.not ? ' · ' + esc(g.not) : ''}</p>` : '<p class="kucuk soluk" style="margin:6px 0 0">Bugün için henüz seçim yapmadın.</p>'}
  </section>`

  if (ben.genelNobet?.gecerli && ben.genelNobetIzni) {
    h += `<section class="kart"><h2>Genel nöbet açık</h2>
      <p class="kucuk soluk" style="margin-top:-4px">Başlanmamış planlardan istediğini al; plan sana atanır. Sayaç ve "Bitti" After Effects panelinde.</p>
      <div class="liste">${D.gnPlanlar.length ? D.gnPlanlar.map((x) => planSatiri({
        anahtar: 'gn:' + x.plan, acil: x.acil, no: x.no, durum: 'bekliyor', aciklama: x.aciklama, sag: esc(x.etiket),
        govde: `<div class="aciklama">${esc(x.aciklama || '')}</div>
          <div class="alt"><span>${esc(x.etiket)}</span><span>Teslim: ${tarihYaz(x.teslim)}</span>${x.sorumlu && x.sorumlu !== '—' ? `<span>Şu an: ${esc(x.sorumlu)}</span>` : ''}</div>
          <button class="btn ana" data-is="isiAl" data-pid="${esc(x.pid)}" data-no="${x.bolum ?? ''}" data-plan="${esc(x.plan)}">İşi al</button>`
      })).join('') : '<div class="bos">Alınabilecek plan yok.</div>'}</div></section>`
  }

  const l = D.gorevler || []
  const acil = l.filter((x) => x.acil)
  const kalan = l.filter((x) => !x.acil)
  const kart = (x) => planSatiri({
    anahtar: 'g:' + x.plan + ':' + (x.rol || '') + ':' + (x.is || ''), acil: x.acil, no: x.no, durum: x.durum, aciklama: x.aciklama,
    sag: esc(x.rol === 'blur' ? 'Blur' : x.rol === 'yardim' ? (x.is || 'Yardım') : kalanYaz(x.teslim)),
    govde: `<div class="kucuk soluk">${esc(x.etiket)}</div>
      ${x.rol === 'blur' ? '<div class="kucuk"><b>Senin işin: Blur</b></div>' : x.rol === 'yardim' ? `<div class="kucuk"><b>Senin işin (Yardım): ${esc(x.is || '')}</b></div>` : ''}
      <div class="aciklama">${esc(x.aciklama || '')}</div>
      ${x.revize ? `<div class="not-kutu"><b>Revize ${esc(x.revize.sayi || '')}</b>${x.revize.not ? ' · ' + esc(x.revize.not) : ''}</div>` : ''}
      <div class="alt"><span>Teslim: ${tarihYaz(x.teslim)}</span><span>${kalanYaz(x.teslim)}</span></div>`
  })
  h += `<section class="kart"><h2>Planlarım <span class="soluk kucuk">(${l.length})</span></h2>
    ${D.gorevler == null ? '<div class="bos">Yükleniyor…</div>' : !l.length ? '<div class="bos">Şu an sana atanmış bitmemiş plan yok.</div>' : `
      <div class="liste">${acil.map(kart).join('')}${acil.length && kalan.length ? '<div class="ayir"></div>' : ''}${kalan.map(kart).join('')}</div>`}
    <p class="kucuk soluk" style="margin:10px 0 0">Sayaç ve "Bitti" After Effects panelinde ya da programda.</p></section>`
  return h
}

// ===== YÖNETİM: Pano =====
function panoEkrani() {
  if (!D.saatler) return '<div class="kart bos">Yükleniyor…</div>'
  const simdi = Date.now()
  const calisanlar = D.saatler.slice().sort((a, b) => String(a.bas).localeCompare(String(b.bas)))
  const aktifKisiler = D.kisiler.filter((k) => k.aktif)
  const bugun = istanbulGunu()
  const gelis = aktifKisiler.map((k) => ({ k, g: k.gelis?.tarih === bugun ? k.gelis : null }))
  const nl = yerelIso(new Date())
  const nobetSimdi = D.ayar.nobetler.filter((n) => !n.bitirildi && n.bas <= nl && nl < n.bit)
  const gn = D.ayar.genelNobet
  const gnAcik = gn && gn.acik && (!gn.bitis || Date.parse(gn.bitis) > simdi)

  let h = `<section class="kart"><div class="ozet-sayilar">
      <div><b>${calisanlar.length}</b><span class="kucuk soluk">şu an çalışıyor</span></div>
      <div><b>${D.acilPlanlar.length}</b><span class="kucuk soluk">acil plan</span></div>
      <div><b>${D.ppSayi}</b><span class="kucuk soluk">post prod bekliyor</span></div>
    </div>
    <p class="kucuk" style="margin:10px 0 0">${nobetSimdi.length ? '☾ Nöbette: <b>' + nobetSimdi.map((n) => esc(kisiAd(n.kisi))).join(', ') + '</b> · ' : ''}${gn ? (gnAcik ? 'Genel nöbet <b>açık</b>' : 'Genel nöbet kapalı') : ''}</p>
  </section>`

  h += `<section class="kart"><h2>Kim çalışıyor</h2>${calisanlar.length ? calisanlar.map((s) => {
    const r = D.panoPlan.get(s.planId)
    const p = projeBul(s.pid || r?.proje_id)
    const kopuk = s.son && simdi - Date.parse(s.son) > 20 * 60000
    const ad = kisiAd(s.kisi)
    return `<div class="calisan"><div class="av">${esc(ad.slice(0, 1))}</div>
      <div><b>${esc(ad)}</b><div class="kucuk soluk">${esc(projeBolum(p, s.bolumNo ?? r?.bolum_no))} · ${esc(kisaNo(r?.veri?.no))}${s.agId ? ' · Yardım adımı' : ''}</div>
        ${r?.veri?.aciklama ? `<div class="kucuk">${esc(String(r.veri.aciklama).slice(0, 120))}</div>` : ''}
        ${kopuk ? `<div class="kucuk" style="color:var(--rev)">Son görülme ${tarihYaz(s.son)} (program kapanmış olabilir)</div>` : ''}</div>
      <div class="sure"><span class="nokta ${kopuk ? 'kirmizi' : ''}"></span>${sureYaz(simdi - Date.parse(s.bas))}</div></div>`
  }).join('') : '<div class="bos">Şu an açık sayaç yok.</div>'}</section>`

  h += `<section class="kart"><h2>Bugün kim geliyor</h2>${gelis.map(({ k, g }) => `
    <div class="satir" style="padding:6px 0;border-bottom:1px solid var(--cizgi)">
      <span class="nokta ${!g ? 'gri' : g.durum === 'geliyor' ? '' : 'kirmizi'}"></span><b>${esc(k.ad)}</b>
      <span class="soluk kucuk">${!g ? 'bilgi yok' : g.durum === 'geliyor' ? 'geliyor' : 'gelemiyor'}${g?.not ? ' · ' + esc(g.not) : ''}</span>
    </div>`).join('')}</section>`

  h += `<section class="kart"><h2>Acil planlar</h2>${D.acilPlanlar.length ? `<div class="liste">${D.acilPlanlar.map((r) => `
    <div class="plan acil"><div class="bas"><span class="acil-yazi">ACİL</span><span class="no">${esc(kisaNo(r.veri.no))}</span><span class="proje">${esc(projeBolum(projeBul(r.proje_id), r.bolum_no))}</span>${durumRozet(r.veri.durum)}</div>
      <div class="aciklama">${esc(r.veri.aciklama || '')}</div><div class="alt"><span>Sorumlu: ${esc(kisiAd(r.veri.sorumlular?.[0]))}</span></div></div>`).join('')}</div>` : '<div class="bos">Acil plan yok.</div>'}</section>`
  return h
}

// ===== YÖNETİM: İşler =====
function islerEkrani() {
  const p = projeBul(D.isP)
  const bolumler = Array.isArray(p?.bolumler) ? p.bolumler : null
  let h = `<section class="kart"><div class="iki">
      <label class="alan"><span>Proje</span><select data-degis="isProje">${D.projeler.map((x) => `<option value="${esc(x.id)}" ${x.id === D.isP ? 'selected' : ''}>${esc(x.ad)}</option>`).join('')}</select></label>
      ${bolumler ? `<label class="alan"><span>Bölüm</span><select data-degis="isBolum">${bolumler.map((b) => `<option value="${b.no}" ${String(b.no) === String(D.isB) ? 'selected' : ''}>${bolumKisa(b.no)}${b.durum === 'teslim' ? ' · teslim edildi' : ''}</option>`).join('')}</select></label>` : '<div></div>'}
    </div>
    <div class="satir">${[['acik', 'Bitmemiş'], ['acil', 'Acil'], ['hepsi', 'Hepsi']].map(([k, ad]) => `<button class="sekme" aria-selected="${D.isSuz === k}" data-is="isSuz" data-k="${k}">${ad}</button>`).join('')}</div>
    ${p ? `<p class="kucuk soluk" style="margin:8px 0 0">Teslim: ${tarihYaz((bolumler ? bolumler.find((b) => String(b.no) === String(D.isB))?.teslim : null) || p.teslim || p.genelTeslim)}</p>` : ''}
  </section>`
  if (!p) return h + '<div class="kart bos">Açık proje yok.</div>'
  if (!D.planlar) return h + '<div class="kart bos">Yükleniyor…</div>'
  const liste = D.planlar.filter((r) => D.isSuz === 'hepsi' || (D.isSuz === 'acil' ? r.veri.acil && r.veri.durum !== 'iptal' : !BITMIS.includes(r.veri.durum)))
  const aktif = D.kisiler.filter((k) => k.aktif)
  h += `<section class="liste">${liste.length ? liste.map((r) => {
    const v = r.veri
    const ek = !!v.anaPlan
    const iptal = v.durum === 'iptal'
    const sorumlu = v.sorumlular?.[0] || ''
    const kisiSecenek = [...(sorumlu && !aktif.some((k) => k.id === sorumlu) ? [{ id: sorumlu, ad: kisiAd(sorumlu) + ' (pasif)' }] : []), ...aktif]
    const ref = `data-pid="${esc(r.proje_id)}" data-no="${r.bolum_no ?? ''}" data-plan="${esc(r.id)}"`
    return planSatiri({
      anahtar: 'i:' + r.id, acil: v.acil, iptal, no: v.no, durum: v.durum, aciklama: v.aciklama,
      sag: esc(ek ? 'ek plate' : kisiAd(sorumlu)),
      govde: `${ek ? '<span class="kucuk soluk">ek plate</span>' : ''}
      <div class="aciklama">${esc(v.aciklama || '')}</div>
      ${v.durum === 'revize' && v.revize ? `<div class="not-kutu"><b>Revize ${esc(v.revize.sayi || '')}</b>${v.revize.not ? ' · ' + esc(v.revize.not) : ''}</div>` : ''}
      ${v.animasalNot ? `<div class="kucuk soluk">Animasal notu: ${esc(v.animasalNot)}</div>` : ''}
      <div class="alt"><span>Sorumlu: ${esc(kisiAd(sorumlu))}</span>${v.sorumlular?.[1] ? `<span>Blur: ${esc(kisiAd(v.sorumlular[1]))}</span>` : ''}${v.sonDegisim ? `<span>Son değişiklik: ${esc(kisiAd(v.sonDegisim.kisi))} · ${tarihYaz(v.sonDegisim.zaman)}</span>` : ''}</div>
      ${ek ? '<p class="kucuk soluk" style="margin:0">Ek plate ana planın sorumlusuyla birlikte değişir.</p>' : iptal ? '<p class="kucuk soluk" style="margin:0">İptal edilmiş plan webde değiştirilmez.</p>' : `
      <div class="kontroller">
        <label class="alan"><span>Durum</span><select data-degis="planDurum" ${ref}>${DURUM_SECIM.map((d) => `<option value="${d}" ${d === (v.durum || 'bekliyor') ? 'selected' : ''}>${DURUM_YAZI[d]}</option>`).join('')}</select></label>
        <label class="alan"><span>Sorumlu</span><select data-degis="planSorumlu" ${ref}>${sorumlu ? '' : '<option value="" selected>— seç —</option>'}${kisiSecenek.map((k) => `<option value="${esc(k.id)}" ${k.id === sorumlu ? 'selected' : ''}>${esc(k.ad)}</option>`).join('')}</select></label>
      </div>
      <button class="btn ${v.acil ? '' : 'kotu'}" data-is="planAcil" data-acil="${v.acil ? '0' : '1'}" ${ref}>${v.acil ? 'Acilden çıkar' : 'Acil yap'}</button>
      ${v.durum === 'revize' && v.revize ? `<label class="alan" style="margin:4px 0 0"><span>Revize notu</span><textarea data-taslak="rn:${esc(r.id)}" maxlength="1000">${esc(taslak('rn:' + r.id, v.revize.not || ''))}</textarea></label>
        <button class="btn" data-is="revizeNot" ${ref}>Revize notunu kaydet</button>` : ''}`}`
    })
  }).join('') : '<div class="kart bos">Bu süzgeçte plan yok.</div>'}</section>`
  return h
}

// ===== YÖNETİM: Post prod =====
function ppIstekYazi(i) {
  const pn = i.plan_id ? kisaNo(D.ppNo.get(i.plan_id)) : ''
  const v = i.veri || {}
  return i.tur === 'acil' ? `${pn} planını ${v.acil === false ? 'acilden çıkarmak' : 'ACİL'} istiyor`
    : i.tur === 'teslim-tarihi' ? `teslim tarihini ${tarihYaz(v.tarih)} yapmak istiyor`
    : i.tur === 'karar' ? `${pn} planını ${PP_KARAR[v.karar] || v.karar}${v.not ? `: “${v.not}”` : ''}`
    : i.tur === 'kalanlari-onayla' ? `kalan ${(v.planlar || []).length} planı onayladı`
    : i.tur === 'link' ? `${v.tanitim ? 'tanıtım ' : ''}linki ekledi` : PP_TUR[i.tur] || i.tur
}
function ppEkrani() {
  if (!D.ppIstek) return '<div class="kart bos">Yükleniyor…</div>'
  const etiket = (pid, no) => projeBolum(projeBul(pid), no) || pid
  if (D.ppSohbet) {
    const p = projeBul(D.ppSohbet)
    return `<section class="kart"><div class="satir" style="justify-content:space-between"><h2 style="margin:0">${esc(p?.ad || '')} · post prod mesajları</h2><button class="btn" data-is="ppKapat">Geri</button></div>
      <div class="mesajlar" id="sohbet" style="margin-top:10px">${D.ppSohbetListe.length ? D.ppSohbetListe.map((m) => `
        <div class="msj ${m.taraf === 'animasal' ? 'ben' : 'karsi'}"><div class="kim">${esc(m.taraf === 'animasal' ? (m.ad || 'Animasal') : (m.ad || m.yazan))}${m.bolum_no != null ? ' · ' + bolumKisa(m.bolum_no) : ''}${m.plan_id && D.ppNo.get(m.plan_id) ? ' · ' + esc(kisaNo(D.ppNo.get(m.plan_id))) : ''} · ${tarihYaz(m.zaman)}</div><div class="metin">${esc(m.metin)}</div></div>`).join('') : '<div class="bos">Henüz mesaj yok.</div>'}</div>
      <label class="alan" style="margin-top:10px"><span>Post prod'a yaz</span><textarea data-taslak="pp:${esc(D.ppSohbet)}" maxlength="4000">${esc(taslak('pp:' + D.ppSohbet))}</textarea></label>
      <div class="iki"><button class="btn ana" data-is="ppGonder">Gönder</button><button class="btn" data-is="ppOkundu" data-pid="${esc(D.ppSohbet)}">Okundu</button></div></section>`
  }
  const ortak = D.ppIstek.filter((i) => i.durum === 'ortak')
  const karsi = D.ppIstek.filter((i) => i.durum === 'karsi')
  const okunmamis = new Map()
  for (const m of D.ppMesaj.slice().reverse()) if (m.taraf === 'musteri' && !m.okundu_animasal) okunmamis.set(m.proje_id, [...(okunmamis.get(m.proje_id) || []), m])
  let h = `<section class="kart"><h2>Kararınızı bekleyenler <span class="soluk kucuk">(${ortak.length})</span></h2>${ortak.length ? `<div class="liste">${ortak.map((i) => {
    const tarihIstegi = i.tur === 'teslim-tarihi'
    const kilit = tarihIstegi && !D.ben.tamYetki
    return `<div class="plan ${i.tur === 'acil' ? 'acil' : ''}"><div class="bas"><span class="proje">${esc(etiket(i.proje_id, i.bolum_no))}</span><span class="kucuk soluk">${tarihYaz(i.zaman)}</span></div>
      <div><b>${esc(i.ad || i.eposta)}</b> ${esc(ppIstekYazi(i))}</div>
      <div class="kucuk soluk">Post prod'un sınırının üstünde; sizin kararınız bekleniyor.</div>
      <label class="alan" style="margin:4px 0 0"><span>Karşı öneri / not</span><input type="text" maxlength="1000" data-taslak="ko:${i.id}" value="${esc(taslak('ko:' + i.id))}"></label>
      <div class="iki"><button class="btn iyi" data-is="ppCevap" data-tur="kabul" data-id="${i.id}" ${kilit ? 'disabled' : ''}>Kabul et</button><button class="btn kotu" data-is="ppCevap" data-tur="red" data-id="${i.id}">Reddet</button></div>
      <button class="btn" data-is="ppCevap" data-tur="karsi" data-id="${i.id}">Karşı öneri gönder</button>
      ${kilit ? '<p class="kucuk soluk" style="margin:0">Teslim tarihi isteğini kabul etmek tam yetki ister.</p>' : ''}</div>`
  }).join('')}</div>` : '<div class="bos">Bekleyen karar yok.</div>'}</section>`

  h += `<section class="kart"><h2>Okunmamış mesajlar</h2>${okunmamis.size ? `<div class="liste">${[...okunmamis].map(([pid, l]) => {
    const son = l[l.length - 1]
    return `<div class="plan"><div class="bas"><span class="proje">${esc(etiket(pid, son.bolum_no))}</span><span class="kucuk soluk">${tarihYaz(son.zaman)}</span>${l.length > 1 ? `<span class="rozet">${l.length}</span>` : ''}</div>
      <div><b>${esc(son.ad || son.yazan)}</b>: “${esc(String(son.metin).slice(0, 300))}”</div>
      <div class="iki"><button class="btn ana" data-is="ppAc" data-pid="${esc(pid)}" data-no="${son.bolum_no ?? ''}" data-plan="${esc(son.plan_id || '')}">Cevapla</button><button class="btn" data-is="ppOkundu" data-pid="${esc(pid)}">Okundu</button></div></div>`
  }).join('')}</div>` : '<div class="bos">Okunmamış mesaj yok.</div>'}
    <div class="ayir"></div>
    <label class="alan"><span>Bir projenin yazışmasını aç</span><select data-degis="ppProje"><option value="">— proje seç —</option>${D.projeler.map((p) => `<option value="${esc(p.id)}">${esc(p.ad)}</option>`).join('')}</select></label></section>`

  if (karsi.length) h += `<section class="kart"><h2>Post prod'un cevabı bekleniyor</h2>${karsi.map((i) => `<p class="kucuk" style="margin:4px 0">${esc(etiket(i.proje_id, i.bolum_no))} · <b>${esc(i.ad || i.eposta)}</b> · ${esc(PP_TUR[i.tur] || i.tur)}: karşı öneri gönderildi${i.cevap?.metin ? ` (“${esc(i.cevap.metin)}”)` : ''}</p>`).join('')}</section>`

  const akis = [
    ...D.ppIstek.filter((i) => Date.parse(i.zaman) > Date.now() - GUN).map((i) => ({ z: i.zaman, pid: i.proje_id, no: i.bolum_no, metin: `${i.ad || i.eposta} · ${ppIstekYazi(i)}${i.durum === 'red' ? ' · reddedildi' : ''}` })),
    ...D.ppMesaj.filter((m) => Date.parse(m.zaman) > Date.now() - GUN).map((m) => ({ z: m.zaman, pid: m.proje_id, no: m.bolum_no, metin: `${m.taraf === 'animasal' ? (m.ad || 'Animasal') + ' → post prod' : m.ad || m.yazan}: “${String(m.metin).slice(0, 120)}”` }))
  ].sort((a, b) => String(b.z).localeCompare(String(a.z)))
  h += `<section class="kart"><h2>Son 24 saat</h2>${akis.length ? akis.map((x) => `<p class="kucuk" style="margin:4px 0"><span class="soluk">${tarihYaz(x.z)} · ${esc(etiket(x.pid, x.no))}</span><br>${esc(x.metin)}</p>`).join('') : '<div class="bos">Son 24 saatte bir şey yok.</div>'}</section>`
  return h
}

// ===== YÖNETİM: Mesajlar (ekiple) =====
const dmKanal = (a, b) => 'dm:' + [a, b].sort().join(':')
function kanallar() {
  const l = [{ k: 'genel', ad: '# genel' }, ...D.projeler.map((p) => ({ k: 'p:' + p.id, ad: '# ' + p.ad }))]
  for (const k of D.kisiler) if (k.aktif && k.id !== D.ben.id) l.push({ k: dmKanal(D.ben.id, k.id), ad: '@ ' + k.ad })
  return l
}
function mesajEkrani() {
  const l = kanallar()
  if (!l.some((x) => x.k === D.kanal)) D.kanal = 'genel'
  return `<section class="kart"><label class="alan"><span>Kanal</span><select data-degis="kanal">${l.map((x) => `<option value="${esc(x.k)}" ${x.k === D.kanal ? 'selected' : ''}>${esc(x.ad)}</option>`).join('')}</select></label>
    <div class="mesajlar" id="kanalMesajlar">${D.kanalMesaj == null ? '<div class="bos">Yükleniyor…</div>' : D.kanalMesaj.length ? D.kanalMesaj.map((m) => `
      <div class="msj ${m.yazan === D.ben.id ? 'ben' : ''}"><div class="kim">${esc(kisiAd(m.yazan))} · ${tarihYaz(m.zaman)}${m.yonetim ? ' · yönetim' : ''}</div><div class="metin">${esc(m.metin)}</div></div>`).join('') : '<div class="bos">Bu kanalda mesaj yok.</div>'}</div>
    <label class="alan" style="margin-top:10px"><span>Mesaj</span><textarea data-taslak="m:${esc(D.kanal)}" maxlength="4000">${esc(taslak('m:' + D.kanal))}</textarea></label>
    <label class="kutu"><input type="checkbox" data-taslak="myon" ${taslak('myon') === true ? 'checked' : ''}> Yönetim olarak gönder (ekranın ortasında görünür)</label>
    <button class="btn ana genis" data-is="mesajGonder">Gönder</button></section>`
}

// ===== YÖNETİM: Nöbet =====
function nobetEkrani() {
  const nl = yerelIso(new Date())
  const gn = D.ayar.genelNobet
  const gnAcik = gn && gn.acik && (!gn.bitis || Date.parse(gn.bitis) > Date.now())
  let h = `<section class="kart"><h2>Genel nöbet</h2>${gn ? `
      <p style="margin:0 0 10px">Şu an: <b>${gnAcik ? 'açık' : 'kapalı'}</b>${gnAcik && gn.kisi ? ' · genel nöbetçi: ' + esc(kisiAd(gn.kisi)) : ''}${gnAcik && gn.bitis ? ' · ' + tarihYaz(gn.bitis) + "'e kadar" : ''}</p>
      <p class="kucuk soluk">${gn.acik ? `Açan: ${esc(kisiAd(gn.acan))} · ${tarihYaz(gn.acilis)}` : gn.kapatan ? `Kapatan: ${esc(kisiAd(gn.kapatan))} · ${tarihYaz(gn.kapanis)}` : ''}</p>
      <button class="btn genis ${gn.acik ? 'kotu' : 'iyi'}" data-is="genelNobet" data-acik="${gn.acik ? '0' : '1'}">${gn.acik ? 'Genel nöbeti kapat' : 'Genel nöbeti aç'}</button>`
    : '<p class="soluk" style="margin:0">Genel nöbet programda henüz kurulmadı. Kurulunca buradan açılıp kapatılır.</p>'}</section>`

  const suren = D.ayar.nobetler.filter((n) => !n.bitirildi && nl < n.bit)
  h += `<section class="kart"><h2>Süren ve gelecek nöbetler</h2>${suren.length ? suren.map((n) => `
    <div class="plan" style="margin-bottom:8px"><div class="bas"><b>☾ ${esc(kisiAd(n.kisi))}</b><span class="kucuk soluk">${n.bas <= nl ? 'şu an nöbette' : 'başlamadı'}</span></div>
      <div class="kucuk">${tarihYaz(n.bas)} – ${tarihYaz(n.bit)} · ${n.projeler?.length ? n.projeler.map((pid) => esc(projeBul(pid)?.ad || 'proje')).join(', ') : 'bütün projeler'}</div>
      <div class="kucuk soluk">Yetkiler: ${(n.yetkiler || []).map((y) => esc((NOBET_YETKILERI.find((x) => x[0] === y) || [y, y])[1])).join('; ') || 'yalnızca canlı pano'}</div>
      ${n.not ? `<div class="kucuk">Not: ${esc(n.not)}</div>` : ''}
      <button class="btn kotu" data-is="nobetBitir" data-id="${esc(n.id)}">${n.bas <= nl ? 'Nöbeti bitir' : 'Nöbeti iptal et'}</button></div>`).join('') : '<div class="bos">Süren nöbet yok.</div>'}</section>`

  const adaylar = D.kisiler.filter((k) => k.aktif && !['yonetici1', 'yonetici2'].includes(k.programRol))
  const varsBas = yerelIso(new Date())
  const b = new Date(); if (b.getHours() >= 9) b.setDate(b.getDate() + 1); b.setHours(9, 0, 0, 0)
  h += `<section class="kart"><h2>Nöbet ata</h2>
    <label class="alan"><span>Nöbetçi</span><select data-taslak="nbKisi"><option value="">— seç —</option>${adaylar.map((k) => `<option value="${esc(k.id)}" ${taslak('nbKisi') === k.id ? 'selected' : ''}>${esc(k.ad)}</option>`).join('')}</select></label>
    <div class="iki"><label class="alan"><span>Başlangıç</span><input type="datetime-local" data-taslak="nbBas" value="${esc(taslak('nbBas', varsBas))}"></label>
    <label class="alan"><span>Bitiş</span><input type="datetime-local" data-taslak="nbBit" value="${esc(taslak('nbBit', yerelIso(b)))}"></label></div>
    <div class="alan"><span>Yetkiler</span>${NOBET_YETKILERI.map(([k, ad]) => `<label class="kutu"><input type="checkbox" data-degis="nbYetki" value="${k}" ${D.nbYetki.has(k) ? 'checked' : ''}> ${esc(ad)}</label>`).join('')}</div>
    <label class="alan"><span>Not (isteğe bağlı)</span><input type="text" maxlength="300" data-taslak="nbNot" value="${esc(taslak('nbNot'))}"></label>
    <p class="kucuk soluk">Webden atanan nöbet bütün projeler içindir. Projeye özel nöbet programdan atanır. Nöbetçiye ve #genel'e mesaj gider.</p>
    <button class="btn ana genis" data-is="nobetAta">Nöbet ata</button></section>`

  const biten = D.ayar.nobetler.filter((n) => n.bitirildi || nl >= n.bit).slice(0, 5)
  if (biten.length) h += `<section class="kart"><h2>Son nöbetler</h2>${biten.map((n) => `<p class="kucuk" style="margin:4px 0"><b>${esc(kisiAd(n.kisi))}</b> · ${tarihYaz(n.bas)} – ${tarihYaz(n.bitirildi && n.bitirildi < n.bit ? n.bitirildi : n.bit)}${n.olaylar?.length ? ` · ${n.olaylar.length} işlem` : ''}</p>`).join('')}</section>`
  return h
}

// ===== YÖNETİM: Teslim tarihleri (salt okunur) =====
function teslimEkrani() {
  const l = []
  for (const p of D.projeler) {
    if (Array.isArray(p.bolumler)) for (const b of p.bolumler) { if (b.durum !== 'teslim') l.push({ p, no: b.no, t: b.teslim || p.teslim || p.genelTeslim }) }
    else l.push({ p, no: null, t: p.teslim || p.genelTeslim })
  }
  l.sort((a, b) => (tarihAl(a.t)?.d || 8.64e15) - (tarihAl(b.t)?.d || 8.64e15))
  return `<section class="kart"><h2>Teslim tarihleri</h2>${l.length ? l.map((x) => `
    <div class="satir" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--cizgi)">
      <span><b>${esc(projeBolum(x.p, x.no))}</b>${x.p.acil ? ' <span class="acil-yazi">ACİL</span>' : ''}</span>
      <span style="text-align:right">${tarihYaz(x.t)}<br><span class="kucuk">${kalanYaz(x.t)}</span></span></div>`).join('') : '<div class="bos">Açık proje yok.</div>'}
    <p class="kucuk soluk" style="margin:10px 0 0">Tarihi revize etmek programdan yapılır.</p></section>`
}

// ---- eylemler ----
async function islem(fn) {
  if (D.mesgul) return
  D.mesgul = true
  document.body.style.cursor = 'progress'
  try { await fn() } catch (e) { bildir(e.message, true) } finally { D.mesgul = false; document.body.style.cursor = '' }
}
const planRef = (el) => ({ p_pid: el.dataset.pid, p_no: el.dataset.no === '' ? null : Number(el.dataset.no), p_plan: el.dataset.plan })
async function planDegistir(el, degisiklik, yazi) {
  const r = await rpc('web_plan_degistir', { ...planRef(el), p_degisiklik: degisiklik })
  if (r?.degisen !== false) kaydedildi(yazi)
  await islerYukle()
  ciz(true)
}

const ISLER = {
  googleGiris: () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } }),
  cikis: async () => { await sb.auth.signOut(); location.reload() },
  tema: () => {
    const sira = ['', 'light', 'dark']
    const yeni = sira[(sira.indexOf(al('wp-tema') || '') + 1) % 3]
    sakla('wp-tema', yeni)
    temaUygula()
    bildir(TEMA_YAZI[yeni])
    ciz(true)
  },
  sekme: async (el) => {
    D.sekme = el.dataset.k
    sakla('wp-sekme', D.sekme)
    ciz(true)
    await tazele()
  },
  gelis: (el) => islem(async () => {
    const g = await rpc('web_gelis', { p_durum: el.dataset.d, p_not: taslak('gelisNot') || null })
    D.ben.gelis = g
    kaydedildi(el.dataset.d === 'geliyor' ? 'Bugün geliyorum kaydedildi' : 'Bugün gelemiyorum kaydedildi')
    ciz(true)
  }),
  isiAl: (el) => islem(async () => {
    const r = await rpc('web_isi_al', planRef(el))
    kaydedildi(`${kisaNo(r?.no)} planı sana atandı`)
    await benimYukle()
    ciz(true)
  }),
  isSuz: (el) => { D.isSuz = el.dataset.k; ciz(true) },
  planAcil: (el) => islem(() => planDegistir(el, { acil: el.dataset.acil === '1' }, el.dataset.acil === '1' ? 'Plan acil yapıldı' : 'Plan acilden çıkarıldı')),
  revizeNot: (el) => islem(async () => {
    await planDegistir(el, { revizeNot: taslak('rn:' + el.dataset.plan, '') }, 'Revize notu kaydedildi')
    delete D.taslak['rn:' + el.dataset.plan]
  }),
  ppCevap: (el) => islem(async () => {
    const tur = el.dataset.tur
    const metin = (taslak('ko:' + el.dataset.id) || '').trim()
    if (tur === 'karsi' && !metin) throw new Error('Karşı öneriyi kutuya yaz.')
    if (tur === 'red' && !confirm('Bu isteği reddetmek istiyor musun?')) return
    await rpc('web_pp_cevap', { p_istek: Number(el.dataset.id), p_tur: tur, p_metin: metin || null })
    delete D.taslak['ko:' + el.dataset.id]
    kaydedildi(tur === 'kabul' ? 'İstek kabul edildi' : tur === 'karsi' ? 'Karşı öneri gönderildi' : 'İstek reddedildi')
    await ortakYukle(); await ppYukle(); ciz(true)
  }),
  ppAc: (el) => islem(async () => {
    D.ppSohbet = el.dataset.pid
    D.ppHedef = { bolum: el.dataset.no === '' ? null : Number(el.dataset.no), plan: el.dataset.plan || null }
    await ppYukle(); ciz(true)
    const s = $('#sohbet'); if (s) s.scrollTop = s.scrollHeight
  }),
  ppKapat: () => islem(async () => { D.ppSohbet = null; D.ppHedef = null; await ppYukle(); ciz(true) }),
  ppGonder: () => islem(async () => {
    const pid = D.ppSohbet
    const metin = (taslak('pp:' + pid) || '').trim()
    if (!metin) throw new Error('Mesaj boş.')
    await rpc('web_pp_mesaj', { p_pid: pid, p_metin: metin, p_bolum: D.ppHedef?.bolum ?? null, p_plan: D.ppHedef?.plan || null })
    delete D.taslak['pp:' + pid]
    kaydedildi("Post prod'a gönderildi")
    await ortakYukle(); await ppYukle(); ciz(true)
    const s = $('#sohbet'); if (s) s.scrollTop = s.scrollHeight
  }),
  ppOkundu: (el) => islem(async () => {
    await rpc('web_pp_mesaj', { p_pid: el.dataset.pid, p_metin: null })
    kaydedildi('Okundu')
    await ortakYukle(); await ppYukle(); ciz(true)
  }),
  mesajGonder: () => islem(async () => {
    const k = D.kanal
    const metin = (taslak('m:' + k) || '').trim()
    if (!metin) throw new Error('Mesaj boş.')
    await rpc('web_mesaj', { p_kanal: k, p_metin: metin, p_yonetim: taslak('myon') === true })
    delete D.taslak['m:' + k]
    kaydedildi('Mesaj gönderildi')
    await mesajYukle(); ciz(true)
    const s = $('#kanalMesajlar'); if (s) s.scrollTop = s.scrollHeight
  }),
  genelNobet: (el) => islem(async () => {
    const acik = el.dataset.acik === '1'
    if (!confirm(acik ? 'Genel nöbet açılsın mı?' : 'Genel nöbet kapatılsın mı?')) return
    await rpc('web_genel_nobet', { p_acik: acik })
    kaydedildi(acik ? 'Genel nöbet açıldı' : 'Genel nöbet kapatıldı')
    await ortakYukle(); ciz(true)
  }),
  nobetBitir: (el) => islem(async () => {
    if (!confirm('Nöbet bitirilsin mi?')) return
    await rpc('web_nobet_bitir', { p_id: el.dataset.id })
    kaydedildi('Nöbet bitirildi')
    await ortakYukle(); ciz(true)
  }),
  nobetAta: () => islem(async () => {
    const kisi = taslak('nbKisi')
    if (!kisi) throw new Error('Nöbetçiyi seç.')
    const bas = $('[data-taslak="nbBas"]')?.value || ''
    const bit = $('[data-taslak="nbBit"]')?.value || ''
    if (!bas || !bit) throw new Error('Başlangıç ve bitişi seç.')
    await rpc('web_nobet_ata', { p_kisi: kisi, p_bas: bas.slice(0, 16), p_bit: bit.slice(0, 16), p_yetkiler: [...D.nbYetki], p_not: taslak('nbNot') || null })
    kaydedildi(`${kisiAd(kisi)} nöbetçi yapıldı`)
    for (const k of ['nbKisi', 'nbNot', 'nbBas', 'nbBit']) delete D.taslak[k]
    await ortakYukle(); ciz(true)
  })
}

const DEGISIM = {
  isProje: async (el) => { D.isP = el.value; D.isB = null; sakla('wp-is-proje', D.isP); D.planlar = null; ciz(true); await islem(async () => { await islerYukle(); sakla('wp-is-bolum', D.isB); ciz(true) }) },
  isBolum: async (el) => { D.isB = el.value; sakla('wp-is-bolum', D.isB); D.planlar = null; ciz(true); await islem(async () => { await islerYukle(); ciz(true) }) },
  planDurum: (el) => islem(async () => {
    const d = el.value
    if (d === 'revize' && !confirm('Plan revizeye dönsün mü? Revize sayısı artar ve sorumluya haber gider.')) { ciz(true); return }
    await planDegistir(el, { durum: d }, 'Durum: ' + DURUM_YAZI[d])
  }),
  planSorumlu: (el) => islem(async () => {
    if (!el.value) return
    const r = D.planlar?.find((x) => x.id === el.dataset.plan)
    if (r?.veri.durum === 'calisiliyor' && !confirm(`Bu planda şu an ${kisiAd(r.veri.sorumlular?.[0])} çalışıyor olabilir. Yine de ${kisiAd(el.value)} kişisine verilsin mi?`)) { ciz(true); return }
    await planDegistir(el, { sorumlu: el.value }, `Plan ${kisiAd(el.value)} kişisine verildi`)
  }),
  ppProje: (el) => { if (el.value) ISLER.ppAc({ dataset: { pid: el.value, no: '', plan: '' } }) },
  kanal: (el) => islem(async () => { D.kanal = el.value; sakla('wp-kanal', D.kanal); D.kanalMesaj = null; ciz(true); await mesajYukle(); ciz(true); const s = $('#kanalMesajlar'); if (s) s.scrollTop = s.scrollHeight }),
  nbYetki: (el) => { if (el.checked) D.nbYetki.add(el.value); else D.nbYetki.delete(el.value) }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-is]')
  if (!el || el.disabled) return
  const f = ISLER[el.dataset.is]
  if (f) f(el)
})
document.addEventListener('change', (e) => {
  const el = e.target
  if (el.dataset?.taslak) D.taslak[el.dataset.taslak] = el.type === 'checkbox' ? el.checked : el.value
  const f = el.dataset?.degis && DEGISIM[el.dataset.degis]
  if (f) f(el)
})
// Telefonda sayfa büyütülünce sabit "Normal görünüm" düğmesi çıkar; basınca büyütme sıfırlanır
// (görünüm ayarı kısa süre en fazla 1 kata kilitlenip geri bırakılır; iPhone ve Android'de büyütmeyi sıfırlar)
;(() => {
  const vv = window.visualViewport
  if (!vv) return
  const d = document.createElement('button')
  d.id = 'normalGorunum'
  d.type = 'button'
  d.textContent = '⤢ Normal görünüm'
  document.body.appendChild(d)
  const bak = () => d.classList.toggle('gorunur', vv.scale > 1.05)
  vv.addEventListener('resize', bak)
  vv.addEventListener('scroll', bak)
  d.addEventListener('click', () => {
    const m = document.querySelector('meta[name="viewport"]')
    if (!m) return
    const eski = m.getAttribute('content')
    m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    setTimeout(() => { m.setAttribute('content', eski); window.scrollTo(0, window.scrollY); bak() }, 350)
  })
})()
// açılan plan satırları yenilemede açık kalsın ('toggle' kabarmaz, yakalama aşamasında dinlenir)
document.addEventListener('toggle', (e) => {
  const k = e.target?.dataset?.ac
  if (!k) return
  if (e.target.open) D.acik.add(k); else D.acik.delete(k)
}, true)
document.addEventListener('input', (e) => {
  const el = e.target
  if (el.dataset?.taslak && el.type !== 'checkbox') D.taslak[el.dataset.taslak] = el.value
})
// Enter ile gönder (çok satırlı kutularda Ctrl+Enter)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  const k = e.target.dataset?.taslak || ''
  const cok = e.target.tagName === 'TEXTAREA'
  if (cok && !(e.ctrlKey || e.metaKey)) return
  if (k.startsWith('m:')) { e.preventDefault(); ISLER.mesajGonder() }
  else if (k.startsWith('pp:')) { e.preventDefault(); ISLER.ppGonder() }
})

basla().catch((e) => girisEkrani('Açılamadı: ' + e.message))
