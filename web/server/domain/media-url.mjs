// One place that decides whether a pasted link is a concrete media item.
// Profiles, search pages, and homepages stop here, before any downloader starts.

const MEDIA_EXT = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma',
  '.aiff', '.aif', '.caf', '.amr', '.mka', '.weba', '.oga',
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.ts', '.mpeg', '.mpg', '.3gp',
]);

export const DOUYIN_PAGE_MESSAGE = '这是抖音主页，不是具体视频。请打开要导入的视频，复制该视频的分享链接。';

function result(platform, kind, normalizedUrl, supported, reason) {
  return { platform, kind, normalizedUrl, supported, reason };
}

function invalid(reason) {
  return result('unknown', 'invalid_url', '', false, reason);
}

function privateHostReason(host) {
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return '不收本机链接';
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) return '不收内网链接';
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return '';
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  if ([a, b, Number(ip[3]), Number(ip[4])].some((n) => n > 255)) return '这不是一条能打开的链接';
  if (a === 10 || a === 127 || a === 0 || a === 255) return '不收内网链接';
  if (a === 192 && b === 168) return '不收内网链接';
  if (a === 172 && b >= 16 && b <= 31) return '不收内网链接';
  if (a === 169 && b === 254) return '不收内网链接';
  return '';
}

function douyinHost(host) {
  return host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com');
}

function bilibiliHost(host) {
  return host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv' || host.endsWith('.b23.tv');
}

function classifyDouyin(url, host) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'user' && parts[1] === 'self') {
    return result('douyin', 'douyin_self_profile', 'https://www.douyin.com/user/self', false, DOUYIN_PAGE_MESSAGE);
  }
  if (parts[0] === 'user') {
    return result('douyin', 'douyin_profile', `https://www.douyin.com/user/${parts[1] || ''}`, false, DOUYIN_PAGE_MESSAGE);
  }
  const modal = url.searchParams.get('modal_id');
  const pathId = url.pathname.match(/\/(?:share\/)?video\/(\d+)/)?.[1];
  const videoId = pathId || (/^\d{6,}$/.test(modal || '') ? modal : '');
  if (videoId) {
    return result('douyin', 'douyin_video', `https://www.douyin.com/video/${videoId}`, true, '');
  }
  const shortHost = host === 'v.douyin.com' || host === 'vm.douyin.com';
  if (shortHost && parts[0]) {
    return result('douyin', 'douyin_short_link', `https://v.douyin.com/${parts[0]}/`, true, '');
  }
  return result('douyin', 'unsupported_page', `https://www.douyin.com${url.pathname}`, false, DOUYIN_PAGE_MESSAGE);
}

function classifyBilibili(url, host) {
  const id = url.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)?.[1];
  if (id) {
    return result('bilibili', 'bilibili_video', `https://www.bilibili.com/video/${id}`, true, '');
  }
  const short = (host === 'b23.tv' || host.endsWith('.b23.tv')) ? url.pathname.split('/').filter(Boolean)[0] : '';
  if (short) return result('bilibili', 'bilibili_video', `https://b23.tv/${short}`, true, '');
  return result('bilibili', 'unsupported_page', url.origin + url.pathname, false, '这是 B 站页面，不是具体视频。请打开要导入的视频，复制该视频的分享链接。');
}

function otherExtractor(host) {
  return /tiktok|youtube|youtu\.be|xiaoyuzhou|ximalaya|podcasts\.apple|soundcloud|spotify|music\.163|castbox|v\.qq\.com|iqiyi|youku|podcast/.test(host);
}

export function classifyMediaUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); }
  catch { return invalid('这不是一条能打开的链接'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalid('只收 http 或 https 链接');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blocked = privateHostReason(host);
  if (blocked) return invalid(blocked);
  if (douyinHost(host)) return classifyDouyin(url, host);
  if (bilibiliHost(host)) return classifyBilibili(url, host);
  const ext = (url.pathname.match(/(\.[A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  if (MEDIA_EXT.has(ext)) return result('direct', 'direct_media', url.href, true, '');
  if (otherExtractor(host)) {
    const bare = url.pathname === '/' || url.pathname === '';
    if (bare) {
      return result('web', 'unsupported_page', url.origin + '/', false, '这不是具体的节目页面。请打开要导入的那一条，再复制链接。');
    }
    return result('web', 'web_media', url.href, true, '');
  }
  return result('unknown', 'unsupported_page', url.href, false, '这个页面不能直接导入。请换具体视频或音频链接，或改用本地文件。');
}
