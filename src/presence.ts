/**
 * Presence: which peers are editing, and where.
 *
 * A `peer` is one collaborator; `presence` is the whole set of peers plus the
 * entry each one is on. Informe owns grouping peers by entry, stacking their
 * avatars, and the overflow cap — callers only supply the peers.
 *
 * `user` is opaque to placement and diffing. The default renderer reads the
 * soft `{ name?, color? }` contract below; a custom `renderPeer` may ignore it
 * and read whatever shape it stored on `user`.
 */

export interface InformePeerUser {
  name?: string;
  color?: string;
}

export interface InformePeerLocation {
  entryId: string;
}

export interface InformePeer<TUser = InformePeerUser> {
  id: string;
  location: InformePeerLocation;
  user: TUser;
}

export type PeerRenderer<TUser = InformePeerUser> = (
  peer: InformePeer<TUser>,
) => HTMLElement;

const STACK_CLASS = 'informe-presence-stack';
const BADGE_CLASS = 'informe-presence-badge';
const OVERFLOW_CLASS = 'informe-presence-overflow';

export function defaultRenderPeer(peer: InformePeer): HTMLElement {
  const badge = document.createElement('span');
  badge.className = BADGE_CLASS;

  const user = peer.user ?? {};
  const name = typeof user.name === 'string' ? user.name.trim() : '';

  badge.textContent = initialsFromName(name) || '?';
  badge.title = name || 'Collaborator';

  if (typeof user.color === 'string' && user.color) {
    badge.style.backgroundColor = user.color;
  }

  return badge;
}

export function groupPeersByEntry<TUser>(
  peers: readonly InformePeer<TUser>[],
): Map<string, InformePeer<TUser>[]> {
  const byEntry = new Map<string, InformePeer<TUser>[]>();

  for (const peer of peers) {
    const list = byEntry.get(peer.location.entryId);

    if (list) {
      list.push(peer);
    } else {
      byEntry.set(peer.location.entryId, [peer]);
    }
  }

  // Stable order by id so an unchanged peer set produces identical DOM.
  for (const list of byEntry.values()) {
    list.sort((left, right) => (
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    ));
  }

  return byEntry;
}

/**
 * A cheap identity for one entry's stack. Equal signatures across ticks mean
 * the rendered element can be reused instead of rebuilt.
 */
export function peerStackSignature<TUser>(
  peers: readonly InformePeer<TUser>[],
  maxPeers: number,
): string {
  const visible = visiblePeers(peers, maxPeers);

  return JSON.stringify({
    visible: visible.map((peer) => ({ id: peer.id, user: peer.user })),
    overflow: peers.length - visible.length,
  });
}

export function buildPeerStack<TUser>(
  peers: readonly InformePeer<TUser>[],
  renderPeer: PeerRenderer<TUser>,
  maxPeers: number,
): HTMLElement {
  const stack = document.createElement('span');
  stack.className = STACK_CLASS;

  const visible = visiblePeers(peers, maxPeers);

  for (const peer of visible) {
    stack.append(renderPeer(peer));
  }

  const overflow = peers.length - visible.length;

  if (overflow > 0) {
    const chip = document.createElement('span');
    chip.className = OVERFLOW_CLASS;
    chip.textContent = `+${overflow}`;
    stack.append(chip);
  }

  return stack;
}

function visiblePeers<TUser>(
  peers: readonly InformePeer<TUser>[],
  maxPeers: number,
): readonly InformePeer<TUser>[] {
  return maxPeers > 0 ? peers.slice(0, maxPeers) : peers;
}

function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';

  return `${first}${last}`.toUpperCase();
}
