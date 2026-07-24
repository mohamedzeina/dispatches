import React, { Component } from 'react';
import { Link } from 'react-router-dom';

import Image from '../../../components/Image/Image';
import Skeleton from '../../../components/Skeleton/Skeleton';
import Sidebar from '../../../components/Sidebar/Sidebar';
import Comment from '../../../components/Comment/Comment';
import CommentComposer from '../../../components/Comment/CommentComposer';
import ErrorHandler from '../../../components/ErrorHandler/ErrorHandler';
import { Close, Heart, HeartFilled } from '../../../components/Icons/Icons';
import './SinglePost.css';
import { GRAPHQL_URL as API_URL } from '../../../config';

/**
 * Single point for GraphQL requests from this component. Centralizes
 * auth header, JSON parsing, and error extraction so the four methods
 * that hit the API don't each reinvent it.
 */
async function gqlRequest({ query, variables, token, fallbackMessage }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors && data.errors.length) {
    const e = data.errors[0];
    throw new Error(e.message || fallbackMessage || 'Request failed.');
  }
  return data.data;
}

/**
 * Build a nested comment tree from the flat list returned by the API.
 * Each root and reply gets a `replies: []` slot; orphans (parent id
 * not present in the list) are treated as roots.
 */
function buildCommentTree(comments) {
  const byId = new Map();
  for (const c of comments) {
    byId.set(c._id, { ...c, replies: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent && byId.has(node.parent)) {
      byId.get(node.parent).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const FETCH_POST_QUERY = `
  query FetchSinglePost($postId: ID!) {
    getPost(id: $postId) {
      title
      content
      creator { _id name avatarUrl }
      imageUrl
      createdAt
      likeCount
      likedByMe
      commentCount
      comments {
        _id
        content
        createdAt
        parent
        author { _id name avatarUrl }
      }
    }
  }
`;

const ADD_COMMENT_QUERY = `
  mutation AddComment($postId: ID!, $content: String!, $parentId: ID) {
    addComment(postId: $postId, content: $content, parentId: $parentId) {
      _id
      content
      createdAt
      parent
      author { _id name avatarUrl }
    }
  }
`;

const formatRelativeDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

class SinglePost extends Component {
  state = {
    title: '',
    author: '',
    authorAvatar: null,
    authorId: null,
    date: '',
    createdAt: null,
    image: '',
    content: '',
    loading: true,
    liked: false,
    likeCount: 0,
    likePending: false,
    comments: [],
    error: null,
  };

  modalBodyRef = React.createRef();

  componentDidMount() {
    if (this.props.asModal) {
      document.addEventListener('keydown', this.handleEscape);
      // Prevent the page underneath from scrolling while the modal is open
      this.prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const postId = this.props.match.params.postId;
    gqlRequest({
      query: FETCH_POST_QUERY,
      variables: { postId },
      token: this.props.token,
      fallbackMessage: 'Fetching post failed.',
    })
      .then((data) => {
        const post = data.getPost;
        this.setState({
          title: post.title,
          author: post.creator.name,
          authorAvatar: post.creator.avatarUrl,
          authorId: post.creator._id,
          image: post.imageUrl,
          createdAt: post.createdAt,
          date: new Date(post.createdAt).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }),
          content: post.content,
          liked: post.likedByMe,
          likeCount: post.likeCount,
          comments: post.comments || [],
          loading: false,
        });
      })
      .catch((err) => {
        // Previously this only set loading:false, which left the user
        // staring at an empty card with no signal. Surface the error
        // through ErrorHandler so they know what happened.
        console.error('Failed to load post', err);
        this.setState({ loading: false, error: err });
      });
  }

  toggleLike = async () => {
    if (this.state.likePending || !this.props.token) return;
    const postId = this.props.match.params.postId;
    const nextLiked = !this.state.liked;
    const prevCount = this.state.likeCount;
    const nextCount = prevCount + (nextLiked ? 1 : -1);

    this.setState({ liked: nextLiked, likeCount: nextCount, likePending: true });

    const mutation = nextLiked ? 'likePost' : 'unlikePost';
    try {
      const data = await gqlRequest({
        query: `mutation L($id: ID!) { ${mutation}(id: $id) { _id likeCount likedByMe } }`,
        variables: { id: postId },
        token: this.props.token,
      });
      const fresh = data[mutation];
      this.setState({ liked: fresh.likedByMe, likeCount: fresh.likeCount });
      if (this.props.onPostUpdate) {
        this.props.onPostUpdate(postId, {
          likeCount: fresh.likeCount,
          likedByMe: fresh.likedByMe,
        });
      }
    } catch (err) {
      this.setState({ liked: !nextLiked, likeCount: prevCount });
      console.error('Like toggle failed', err);
    } finally {
      this.setState({ likePending: false });
    }
  };

  // ---- Comments ----------------------------------------

  /**
   * Add a comment or reply. Pass parentId to nest under another
   * comment, or null for a top-level comment. Optimistic update
   * inserts a temporary record with __pending: true so the new
   * node renders immediately.
   */
  addComment = async (parentId, content) => {
    const postId = this.props.match.params.postId;
    // clientId is the stable React key — it survives the optimistic →
    // real swap so the bubble never unmounts/remounts. _id starts as a
    // temp value, then gets replaced with the real server id; clientId
    // stays the same throughout.
    const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      _id: clientId,
      clientId,
      content,
      createdAt: new Date().toISOString(),
      parent: parentId || null,
      author: this.props.currentUser
        ? {
            _id: this.props.currentUser._id,
            name: this.props.currentUser.name,
            avatarUrl: this.props.currentUser.avatarUrl,
          }
        : { _id: this.props.userId, name: 'You', avatarUrl: null },
      __pending: true,
    };
    this.setState((prev) => ({ comments: [...prev.comments, optimistic] }));

    // In modal mode, scroll the new comment into view so the user
    // never has to hunt for what they just posted.
    //   - Top-level: scroll body to the bottom (the new comment lands
    //     at the end of the root list, just above the composer dock)
    //   - Reply: scrollIntoView the specific new reply element by its
    //     clientId — it lives nested under its parent in the tree
    if (this.props.asModal && this.modalBodyRef.current) {
      requestAnimationFrame(() => {
        const body = this.modalBodyRef.current;
        if (!body) return;
        if (parentId) {
          // CSS.escape is defensive — clientId is internally generated
          // (alphanumeric + hyphens) so today it's selector-safe, but
          // escaping survives any future change to the clientId format.
          const sel = `[data-client-id="${CSS.escape(clientId)}"]`;
          const el = body.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
        }
      });
    }

    try {
      const data = await gqlRequest({
        query: ADD_COMMENT_QUERY,
        variables: { postId, content, parentId: parentId || null },
        token: this.props.token,
      });

      const real = data.addComment;
      let nextLength = 0;
      this.setState(
        (prev) => {
          // Merge real fields onto the existing optimistic record so the
          // React element stays the same instance — no remount, no flicker.
          const comments = prev.comments.map((c) =>
            c.clientId === clientId
              ? { ...real, clientId, __pending: false }
              : c
          );
          nextLength = comments.length;
          return { comments };
        },
        () => {
          if (this.props.onPostUpdate) {
            this.props.onPostUpdate(postId, { commentCount: nextLength });
          }
        }
      );
    } catch (err) {
      this.setState((prev) => ({
        comments: prev.comments.filter((c) => c.clientId !== clientId),
        error: err,
      }));
      throw err;
    }
  };

  deleteComment = async (id) => {
    // Hold on to the comment in case we need to restore it.
    // Cascade locally: drop the target + any descendants so the count
    // matches what the server is about to do.
    const previous = this.state.comments;
    const childrenByParent = new Map();
    for (const c of previous) {
      const k = c.parent || null;
      if (!childrenByParent.has(k)) childrenByParent.set(k, []);
      childrenByParent.get(k).push(c._id);
    }
    const toRemove = new Set([id]);
    const frontier = [id];
    while (frontier.length) {
      const next = frontier.shift();
      const kids = childrenByParent.get(next) || [];
      for (const k of kids) {
        if (!toRemove.has(k)) {
          toRemove.add(k);
          frontier.push(k);
        }
      }
    }
    const remaining = previous.filter((c) => !toRemove.has(c._id));
    this.setState({ comments: remaining });

    try {
      await gqlRequest({
        query: `mutation DeleteComment($id: ID!) { deleteComment(id: $id) }`,
        variables: { id },
        token: this.props.token,
      });
      if (this.props.onPostUpdate) {
        this.props.onPostUpdate(this.props.match.params.postId, {
          commentCount: remaining.length,
        });
      }
    } catch (err) {
      this.setState({ comments: previous, error: err });
    }
  };

  componentWillUnmount() {
    if (this.props.asModal) {
      document.removeEventListener('keydown', this.handleEscape);
      document.body.style.overflow = this.prevBodyOverflow || '';
    }
  }

  handleEscape = (e) => {
    if (e.key === 'Escape' && this.props.onClose) {
      this.props.onClose();
    }
  };

  /**
   * Close when the click lands on the scroll-container itself
   * (the "backdrop" area around the card) — not on the card or its
   * descendants. The Backdrop component in App.js sits visually
   * behind us at z-index 200 but our scroll-container covers it
   * (inset: 0, z-index 280), so we own the dismiss behaviour here.
   */
  handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && this.props.onClose) {
      this.props.onClose();
    }
  };

  dismissError = () => this.setState({ error: null });

  /**
   * The like button — identical JSX in both the page card footer and
   * the modal's like-row. Extracted so the heart icon, copy, and
   * pressed/pending state stay in one place.
   */
  renderLikeButton() {
    const { liked, likeCount, likePending } = this.state;
    return (
      <button
        type="button"
        className={[
          'single-post__like',
          liked ? 'is-liked' : '',
          likePending ? 'is-pending' : '',
        ].filter(Boolean).join(' ')}
        onClick={this.toggleLike}
        aria-pressed={liked}
      >
        <span className="single-post__like-icon" aria-hidden="true">
          {liked ? <HeartFilled size={18} /> : <Heart size={18} />}
        </span>
        <span>
          {likeCount > 0
            ? `${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`
            : 'Be the first to like this'}
        </span>
      </button>
    );
  }

  // ---------- Helpers for the inner content (shared by page + modal) ----------

  renderSkeletonCard() {
    return (
      <div className="single-post__card">
        <header className="single-post__header">
          <Skeleton variant="circle" width="2.6rem" height="2.6rem" />
          <div className="single-post__byline" style={{ flex: 1, maxWidth: '14rem' }}>
            <Skeleton variant="text" width="45%" />
            <div style={{ height: '0.35rem' }} />
            <Skeleton variant="text" width="30%" />
          </div>
        </header>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.2rem' }}>
          <Skeleton variant="text" width="80%" height="2rem" />
          <Skeleton variant="text" width="55%" height="2rem" />
        </div>
        <div className="single-post__image">
          <Skeleton width="100%" height="100%" radius={0} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <Skeleton variant="text" width="98%" />
          <Skeleton variant="text" width="94%" />
          <Skeleton variant="text" width="100%" />
          <Skeleton variant="text" width="72%" />
        </div>
        <footer className="single-post__footer">
          <Skeleton width="9rem" height="2.5rem" radius="999px" />
        </footer>

        <section className="single-post__comments" aria-busy="true">
          <div className="single-post__comments-head">
            <Skeleton variant="text" width="5rem" height="1.1rem" />
            <Skeleton width="4.5rem" height="1.4rem" radius="999px" />
          </div>
          <div className="single-post__composer-skeleton">
            <Skeleton variant="circle" width="2.1rem" height="2.1rem" />
            <div className="single-post__composer-skeleton-body">
              <Skeleton variant="rect" height="2.4rem" radius="14px" />
              <div className="single-post__composer-skeleton-footer">
                <Skeleton width="6rem" height="2rem" radius="999px" />
              </div>
            </div>
          </div>
          <ul className="single-post__comments-list">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <div className="comment" aria-busy="true">
                  <Skeleton variant="circle" width="2.1rem" height="2.1rem" />
                  <div className="comment__bubble">
                    <div className="comment__head" style={{ width: '100%' }}>
                      <Skeleton variant="text" width={`${30 + i * 8}%`} height="0.85rem" />
                      <Skeleton variant="text" width="2.5rem" height="0.75rem" />
                    </div>
                    <Skeleton variant="text" width="100%" />
                    <div style={{ height: '0.3rem' }} />
                    <Skeleton variant="text" width={`${68 + i * 6}%`} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  renderCard() {
    const initial = (this.state.author || '').trim().charAt(0).toUpperCase() || '?';
    const roots = buildCommentTree(this.state.comments);
    const total = this.state.comments.length;

    return (
      <div className="single-post__card">
        <header className="single-post__header">
          {this.state.authorId ? (
            <Link
              to={`/u/${this.state.authorId}`}
              className="single-post__avatar single-post__avatar--link"
              aria-label={`View ${this.state.author}'s profile`}
            >
              {this.state.authorAvatar ? (
                <img src={this.state.authorAvatar} alt="" />
              ) : (
                <span>{initial}</span>
              )}
            </Link>
          ) : (
            <div className="single-post__avatar" aria-hidden="true">
              {this.state.authorAvatar ? (
                <img src={this.state.authorAvatar} alt="" />
              ) : (
                <span>{initial}</span>
              )}
            </div>
          )}
          <div className="single-post__byline">
            {this.state.authorId ? (
              <Link to={`/u/${this.state.authorId}`} className="single-post__author">
                {this.state.author || '—'}
              </Link>
            ) : (
              <span className="single-post__author">{this.state.author || '—'}</span>
            )}
            <span className="single-post__date">{this.state.date}</span>
          </div>
        </header>

        <h1 className="single-post__title">{this.state.title || ''}</h1>

        {this.state.image && (
          <div className="single-post__image">
            <Image contain imageUrl={this.state.image} />
          </div>
        )}

        <div className="single-post__content">{this.state.content}</div>

        <footer className="single-post__footer">
          {this.renderLikeButton()}
        </footer>

        <section className="single-post__comments" aria-label="Comments">
          <div className="single-post__comments-head">
            <h2 className="single-post__comments-title">Comments</h2>
            <span className="single-post__comments-count">
              {total} {total === 1 ? 'reply' : 'replies'}
            </span>
          </div>

          <CommentComposer
            currentUser={this.props.currentUser}
            onSubmit={(text) => this.addComment(null, text)}
          />

          {roots.length === 0 ? (
            <div className="single-post__comments-empty">
              <p>No replies yet. Be the first to say something.</p>
            </div>
          ) : (
            <ul className="single-post__comments-list">
              {roots.map((c) => (
                <li key={c.clientId || c._id}>
                  <Comment
                    comment={c}
                    depth={0}
                    viewerId={this.props.userId}
                    currentUser={this.props.currentUser}
                    onAddReply={this.addComment}
                    onDelete={this.deleteComment}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  /**
   * Modal — a dedicated "reader's room" surface, distinct from the
   * page view. Three regions inside a flex-column shell:
   *   1. Sticky topbar — avatar + name + relative date + close X.
   *      Always visible so you never lose context as you scroll.
   *   2. Scrollable body — title, image, content, like row, comments.
   *      Owns the scroll; the rest of the shell stays put.
   *   3. Sticky composer dock — CommentComposer always one click away
   *      regardless of how long the post or thread is.
   * Clicks on the shell itself stop propagation so only clicks on the
   * surrounding empty space close the modal.
   */
  renderModal() {
    const { loading } = this.state;
    const initial = (this.state.author || '').trim().charAt(0).toUpperCase() || '?';
    const roots = buildCommentTree(this.state.comments);
    const total = this.state.comments.length;

    return (
      <div
        className="single-post-modal"
        role="dialog"
        aria-modal="true"
        onClick={this.handleBackdropClick}
      >
        <div
          className="single-post-modal__shell"
          onClick={(e) => e.stopPropagation()}
        >
          <ErrorHandler error={this.state.error} onHandle={this.dismissError} />

          {/* ===== Sticky topbar — always-visible context ===== */}
          <header className="single-post-modal__topbar">
            {loading ? (
              <>
                <Skeleton variant="circle" width="2.2rem" height="2.2rem" />
                <div className="single-post-modal__topbar-meta">
                  <Skeleton variant="text" width="7rem" height="0.95rem" />
                  <div style={{ height: '0.2rem' }} />
                  <Skeleton variant="text" width="4rem" height="0.7rem" />
                </div>
              </>
            ) : (
              <>
                {this.state.authorId ? (
                  <Link
                    to={`/u/${this.state.authorId}`}
                    className="single-post-modal__topbar-avatar"
                    aria-label={`View ${this.state.author}'s profile`}
                  >
                    {this.state.authorAvatar ? (
                      <img src={this.state.authorAvatar} alt="" />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </Link>
                ) : (
                  <div className="single-post-modal__topbar-avatar" aria-hidden="true">
                    {this.state.authorAvatar ? (
                      <img src={this.state.authorAvatar} alt="" />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </div>
                )}
                <div className="single-post-modal__topbar-meta">
                  {this.state.authorId ? (
                    <Link
                      to={`/u/${this.state.authorId}`}
                      className="single-post-modal__topbar-name"
                    >
                      {this.state.author}
                    </Link>
                  ) : (
                    <span className="single-post-modal__topbar-name">
                      {this.state.author}
                    </span>
                  )}
                  <span
                    className="single-post-modal__topbar-date"
                    title={this.state.date}
                  >
                    {formatRelativeDate(this.state.createdAt)}
                  </span>
                </div>
              </>
            )}
            <button
              type="button"
              className="single-post-modal__topbar-close"
              onClick={this.props.onClose}
              aria-label="Close"
            >
              <Close size={16} />
            </button>
          </header>

          {/* ===== Scrollable body ===== */}
          <div
            className="single-post-modal__body"
            ref={this.modalBodyRef}
            aria-busy={loading || undefined}
          >
            {loading ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Skeleton variant="text" width="70%" height="1.8rem" />
                  <Skeleton variant="text" width="48%" height="1.8rem" />
                </div>
                <div className="single-post-modal__image">
                  <Skeleton width="100%" height="100%" radius={0} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.2rem' }}>
                  <Skeleton variant="text" width="98%" />
                  <Skeleton variant="text" width="94%" />
                  <Skeleton variant="text" width="100%" />
                  <Skeleton variant="text" width="72%" />
                </div>
                <div className="single-post-modal__like-row">
                  <Skeleton width="9rem" height="2.5rem" radius="999px" />
                </div>
                <section className="single-post-modal__comments" aria-label="Comments loading">
                  <div className="single-post-modal__comments-head">
                    <Skeleton variant="text" width="5rem" height="1.05rem" />
                    <Skeleton width="4rem" height="1.4rem" radius="999px" />
                  </div>
                  <ul className="single-post__comments-list">
                    {[0, 1, 2].map((i) => (
                      <li key={i}>
                        <div className="comment" aria-busy="true">
                          <Skeleton variant="circle" width="2.1rem" height="2.1rem" />
                          <div className="comment__column">
                            <div className="comment__bubble">
                              <div className="comment__head" style={{ width: '100%' }}>
                                <Skeleton variant="text" width={`${30 + i * 8}%`} height="0.85rem" />
                                <Skeleton variant="text" width="2.5rem" height="0.75rem" />
                              </div>
                              <Skeleton variant="text" width="100%" />
                              <div style={{ height: '0.3rem' }} />
                              <Skeleton variant="text" width={`${68 + i * 6}%`} />
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : (
              <>
                <h1 className="single-post-modal__title">{this.state.title}</h1>

                {this.state.image && (
                  <div className="single-post-modal__image">
                    <Image contain imageUrl={this.state.image} />
                  </div>
                )}

                <div className="single-post-modal__content">{this.state.content}</div>

                <div className="single-post-modal__like-row">
                  {this.renderLikeButton()}
                </div>

                <section className="single-post-modal__comments" aria-label="Comments">
                  <div className="single-post-modal__comments-head">
                    <h2 className="single-post-modal__comments-title">Comments</h2>
                    <span className="single-post-modal__comments-count">
                      {total} {total === 1 ? 'reply' : 'replies'}
                    </span>
                  </div>

                  {roots.length === 0 ? (
                    <div className="single-post-modal__comments-empty">
                      <p>No replies yet. Start the conversation below.</p>
                    </div>
                  ) : (
                    <ul className="single-post__comments-list">
                      {roots.map((c) => (
                        <li key={c.clientId || c._id}>
                          <Comment
                            comment={c}
                            depth={0}
                            viewerId={this.props.userId}
                            currentUser={this.props.currentUser}
                            onAddReply={this.addComment}
                            onDelete={this.deleteComment}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          {/* ===== Sticky composer dock — always one click away ===== */}
          <div className="single-post-modal__composer-dock">
            <CommentComposer
              currentUser={this.props.currentUser}
              onSubmit={(text) => this.addComment(null, text)}
              placeholder="Write a comment…"
            />
          </div>
        </div>
      </div>
    );
  }

  render() {
    const { loading } = this.state;

    if (this.props.asModal) {
      return this.renderModal();
    }

    // ---- Page mode (direct URL / refresh) ----
    const inner = loading ? this.renderSkeletonCard() : this.renderCard();
    return (
      <div className="app-page">
        <div className="app-page__sidebar">
          <Sidebar currentUser={this.props.currentUser} />
        </div>

        <div className="app-page__main">
          <ErrorHandler error={this.state.error} onHandle={this.dismissError} />
          <article className="single-post">
            {loading ? (
              <div className="single-post__back-skeleton">
                <Skeleton width="5rem" height="1.6rem" radius="999px" />
              </div>
            ) : (
              <Link to="/" className="single-post__back">
                ← Back to Home
              </Link>
            )}
            {inner}
          </article>
        </div>
      </div>
    );
  }
}

export default SinglePost;
