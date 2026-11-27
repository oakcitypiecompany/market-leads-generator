// Finds posts and the account's details in whatever JSON Instagram's profile page loads
// (inline <script> data and the requests it makes while scrolling). Walking the JSON instead of
// expecting one exact shape keeps this working when Instagram renames its queries.
// When the Meta API works, replace fetch.ts's collection step with Business Discovery and keep Post.

export type Post = {
  shortcode: string;
  url: string;
  caption: string;
  takenAt: number;
  isVideo: boolean;
  imageUrls: string[];
};

export type AccountInfo = { isPrivate?: boolean; isPersonal?: boolean };

// visit returns true to skip an object's children (a post's own carousel items aren't posts).
function walk(value: unknown, visit: (o: any) => boolean | void) {
  if (Array.isArray(value)) for (const v of value) walk(v, visit);
  else if (value && typeof value === 'object') {
    if (visit(value)) return;
    for (const v of Object.values(value)) walk(v, visit);
  }
}

// Instagram lists image sizes in candidates; take the widest.
const bestImage = (m: any): string | undefined =>
  [...(m?.image_versions2?.candidates ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;

export function findPosts(json: unknown, handle: string): Post[] {
  const found: Post[] = [];
  walk(json, o => {
    if (typeof o.code !== 'string' || typeof o.taken_at !== 'number') return;
    const owner = o.user?.username ?? o.owner?.username;
    if (owner && owner.toLowerCase() !== handle) return; // suggested or tagged posts from other accounts
    const imageUrls = (o.carousel_media?.length ? o.carousel_media.map(bestImage) : [bestImage(o)]).filter(Boolean);
    if (!imageUrls.length) return true;
    found.push({
      shortcode: o.code,
      url: `https://www.instagram.com/p/${o.code}/`,
      caption: o.caption?.text ?? '',
      takenAt: o.taken_at,
      // media_type 2 = video; its image_versions2 is the thumbnail.
      isVideo: o.media_type === 2 || !!o.video_versions,
      imageUrls,
    });
    return true;
  });
  return found;
}

export function findAccount(json: unknown, handle: string): AccountInfo {
  const info: AccountInfo = {};
  walk(json, o => {
    if (typeof o.username !== 'string' || o.username.toLowerCase() !== handle) return;
    if (typeof o.is_private === 'boolean') info.isPrivate = o.is_private;
    // Only mark personal on positive evidence; missing fields mean "unknown", which stays watched.
    if (o.account_type === 1 || (o.is_business === false && o.is_professional_account === false)) info.isPersonal = true;
    if (o.account_type === 2 || o.account_type === 3 || o.is_business === true || o.is_professional_account === true) info.isPersonal = false;
  });
  return info;
}
