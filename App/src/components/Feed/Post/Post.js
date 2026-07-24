import React, { useState, useEffect } from 'react';
import { Link, withRouter } from 'react-router-dom';

import Image from '../../Image/Image';
import { Heart, HeartFilled, Reply, Share, Pencil, Trash } from '../../Icons/Icons';
import './Post.css';
import { GRAPHQL_URL as API_URL } from '../../../config';

const Post = props => {
  const { id, token, likedByMe = false, likeCount = 0 } = props;
  const [liked, setLiked] = useState(likedByMe);
  const [count, setCount] = useState(likeCount);
  const [pending, setPending] = useState(false);
  // Bursts is a list of timestamps; each one renders a floating heart
  // that flies up and fades. Trimmed after the animation completes.
  const [bursts, setBursts] = useState([]);

  // Keep local state in sync if parent re-fetches the feed
  useEffect(() => { setLiked(likedByMe); }, [likedByMe]);
  useEffect(() => { setCount(likeCount); }, [likeCount]);

  const toggleLike = async () => {
    if (pending || !token) return;
    const nextLiked = !liked;
    const nextCount = count + (nextLiked ? 1 : -1);

    // Optimistic update + delight burst when newly liked
    setLiked(nextLiked);
    setCount(nextCount);
    setPending(true);
    if (nextLiked) {
      const stamp = Date.now() + Math.random();
      setBursts((b) => [...b, stamp]);
      setTimeout(() => {
        setBursts((b) => b.filter((s) => s !== stamp));
      }, 900);
    }

    const mutation = nextLiked ? 'likePost' : 'unlikePost';
    const query = {
      query: `mutation L($id: ID!) { ${mutation}(id: $id) { _id likeCount likedByMe } }`,
      variables: { id },
    };

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(query),
      });
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0].message);
      const fresh = data.data[mutation];
      setLiked(fresh.likedByMe);
      setCount(fresh.likeCount);
    } catch (err) {
      setLiked(!nextLiked);
      setCount(count);
      console.error('Like toggle failed', err);
    } finally {
      setPending(false);
    }
  };

  const initial = (props.author || '').trim().charAt(0).toUpperCase() || '?';

  // Link to /p/:id but stash the current location so App.js renders
  // it as a modal overlay over the feed/profile rather than as a
  // full page navigation.
  const postLinkTo = {
    pathname: '/p/' + props.id,
    state: { background: props.location },
  };

  return (
    <article className="post">
      <span className="post__rail" aria-hidden="true" />

      <header className="post__header">
        {props.authorId ? (
          <Link
            to={`/u/${props.authorId}`}
            className="post__avatar post__avatar--link"
            aria-label={`View ${props.author}'s profile`}
          >
            {props.authorAvatar ? (
              <img src={props.authorAvatar} alt="" loading="lazy" />
            ) : (
              <span>{initial}</span>
            )}
          </Link>
        ) : (
          <div className="post__avatar" aria-hidden="true">
            {props.authorAvatar ? (
              <img src={props.authorAvatar} alt="" loading="lazy" />
            ) : (
              <span>{initial}</span>
            )}
          </div>
        )}
        <div className="post__byline">
          {props.authorId ? (
            <Link to={`/u/${props.authorId}`} className="post__author">
              {props.author}
            </Link>
          ) : (
            <span className="post__author">{props.author}</span>
          )}
          <span className="post__date">
            <span className="post__date-dot" aria-hidden="true" />
            {props.date}
          </span>
        </div>
        {props.isOwn && (
          <div className="post__menu">
            <button
              className="post__menu-btn"
              onClick={props.onStartEdit}
              aria-label="Edit"
              title="Edit"
            >
              <Pencil size={16} />
            </button>
            <button
              className="post__menu-btn post__menu-btn--danger"
              onClick={props.onDelete}
              aria-label="Delete"
              title="Delete"
            >
              <Trash size={16} />
            </button>
          </div>
        )}
      </header>

      <Link to={postLinkTo} className="post__body">
        <h2 className="post__title">{props.title}</h2>
        <p className="post__content">{props.content}</p>
      </Link>

      {props.image && (
        <Link to={postLinkTo} className="post__image">
          <Image imageUrl={props.image} />
        </Link>
      )}

      <footer className="post__footer">
        <button
          className={[
            'post__action',
            'post__action--like',
            liked ? 'is-liked' : '',
            pending ? 'is-pending' : '',
          ].join(' ')}
          onClick={toggleLike}
          aria-label={liked ? 'Unlike' : 'Like'}
          aria-pressed={liked}
        >
          <span className="post__action-icon" aria-hidden="true">
            {liked ? <HeartFilled size={18} /> : <Heart size={18} />}
          </span>
          <span className="post__action-label">
            {count > 0 ? count : 'Like'}
          </span>
          {/* Floating-heart bursts when the user newly likes a post */}
          {bursts.map((stamp) => (
            <span key={stamp} className="post__heart-burst" aria-hidden="true">
              <HeartFilled size={20} />
            </span>
          ))}
        </button>

        <Link to={postLinkTo} className="post__action">
          <span className="post__action-icon" aria-hidden="true">
            <Reply size={18} />
          </span>
          <span className="post__action-label">
            {props.commentCount > 0 ? props.commentCount : 'Reply'}
          </span>
        </Link>

        <button
          className="post__action"
          onClick={() => {
            if (navigator.share) {
              navigator.share({
                title: props.title,
                url: window.location.origin + '/p/' + props.id,
              }).catch(() => {});
            }
          }}
          aria-label="Share"
        >
          <span className="post__action-icon" aria-hidden="true">
            <Share size={18} />
          </span>
          <span className="post__action-label">Share</span>
        </button>
      </footer>
    </article>
  );
};

export default withRouter(Post);
