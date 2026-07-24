import React, { Component } from 'react';
import { Link } from 'react-router-dom';

import Post from '../../components/Feed/Post/Post';
import Skeleton from '../../components/Skeleton/Skeleton';
import PostSkeleton from '../../components/Skeleton/PostSkeleton';
import ErrorHandler from '../../components/ErrorHandler/ErrorHandler';
import Sidebar from '../../components/Sidebar/Sidebar';
import './Profile.css';
import { GRAPHQL_URL as API_URL } from '../../config';

const formatJoined = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

class Profile extends Component {
  state = {
    user: null,
    posts: [],
    loading: true,
    error: null,
  };

  componentDidMount() {
    this.loadProfile();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.match.params.userId !== this.props.match.params.userId) {
      this.setState({ loading: true, user: null, posts: [] });
      this.loadProfile();
      return;
    }

    // Merge post-level updates broadcast from the modal SinglePost
    // so the profile's post list reflects them on modal close.
    const prev = prevProps.postUpdate;
    const next = this.props.postUpdate;
    if (next && (!prev || prev.version !== next.version)) {
      this.setState((state) => ({
        posts: state.posts.map((p) =>
          p._id === next.postId ? { ...p, ...next.fields } : p
        ),
      }));
    }
  }

  loadProfile = () => {
    const userId = this.props.match.params.userId;
    const graphqlQuery = {
      query: `
        query GetProfile($id: ID!) {
          getUser(id: $id) {
            _id
            name
            status
            avatarUrl
            createdAt
            posts {
              _id
              title
              content
              imageUrl
              createdAt
              likeCount
              likedByMe
              commentCount
              creator { _id name avatarUrl }
            }
          }
        }
      `,
      variables: { id: userId },
    };

    fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.props.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.errors) {
          const e = data.errors[0];
          throw new Error(e.message || 'Failed to load profile.');
        }
        const u = data.data.getUser;
        this.setState({
          user: {
            _id: u._id,
            name: u.name,
            status: u.status,
            avatarUrl: u.avatarUrl,
            createdAt: u.createdAt,
          },
          posts: u.posts || [],
          loading: false,
        });
      })
      .catch((err) => {
        console.error(err);
        this.setState({ loading: false, error: err });
      });
  };

  dismissError = () => this.setState({ error: null });

  render() {
    const { user, posts, loading, error } = this.state;
    const isOwn = user && user._id === this.props.userId;

    if (loading) {
      return (
        <div className="app-page">
          <div className="app-page__sidebar">
            <Sidebar currentUser={this.props.currentUser} />
          </div>

          <div className="app-page__main">
            <div className="profile">
              {/* Back link slot kept stable so the page doesn't jump on load */}
              <div className="profile__back-skeleton">
                <Skeleton width="5rem" height="1.6rem" radius="999px" />
              </div>

              <header className="profile__hero profile__hero--skeleton">
                <span className="profile__accent" aria-hidden="true" />
                <div className="profile__hero-top">
                  <Skeleton variant="circle" width="5rem" height="5rem" />
                  <div className="profile__identity">
                    <Skeleton variant="text" width="55%" height="1.8rem" />
                    <div style={{ height: '0.5rem' }} />
                    <Skeleton variant="text" width="85%" />
                  </div>
                  <Skeleton width="6.5rem" height="2.25rem" radius="999px" />
                </div>
                <div className="profile__stats">
                  <Skeleton width="3.5rem" height="2.25rem" />
                  <div className="profile__stat-sep" aria-hidden="true" />
                  <Skeleton width="4rem" height="2.25rem" />
                  <div className="profile__stat-sep" aria-hidden="true" />
                  <Skeleton width="5rem" height="2.25rem" />
                </div>
              </header>

              <section className="profile__posts">
                <div className="profile__posts-header">
                  <Skeleton variant="text" width="6rem" height="1.4rem" />
                  <Skeleton width="5rem" height="1.6rem" radius="999px" />
                </div>
                <PostSkeleton />
                <PostSkeleton />
              </section>
            </div>
          </div>
        </div>
      );
    }

    if (!user) {
      return (
        <div className="app-page">
          <div className="app-page__sidebar">
            <Sidebar currentUser={this.props.currentUser} />
          </div>
          <div className="app-page__main">
            <div className="profile profile--empty">
              <ErrorHandler error={error} onHandle={this.dismissError} />
              <div className="profile__not-found">
                <h2>This person doesn&rsquo;t exist</h2>
                <p>We couldn&rsquo;t find that account.</p>
                <Link to="/" className="profile__link">&larr; Back to Home</Link>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const initial = (user.name || '').trim().charAt(0).toUpperCase() || '?';
    const joined = formatJoined(user.createdAt);
    const totalLikes = posts.reduce((sum, p) => sum + (p.likeCount || 0), 0);

    return (
      <div className="app-page">
        <div className="app-page__sidebar">
          <Sidebar currentUser={this.props.currentUser} />
        </div>

        <div className="app-page__main">
          <div className="profile">
            <ErrorHandler error={error} onHandle={this.dismissError} />

            <Link to="/" className="profile__back">← Home</Link>

            <header className="profile__hero">
          {/* Accent rule — a small decorative bar on the left */}
          <span className="profile__accent" aria-hidden="true" />

          <div className="profile__hero-top">
            <span className="profile__avatar" aria-hidden="true">
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt="" />
                : <span>{initial}</span>}
            </span>

            <div className="profile__identity">
              <h1 className="profile__name">{user.name}</h1>
              {user.status && (
                <p className="profile__status">
                  <span className="profile__status-mark" aria-hidden="true">“</span>
                  {user.status}
                  <span className="profile__status-mark profile__status-mark--close" aria-hidden="true">”</span>
                </p>
              )}
            </div>

            <div className="profile__actions">
              {isOwn ? (
                <button
                  type="button"
                  className="profile__action profile__action--soon"
                  disabled
                >
                  Edit profile
                  <span className="profile__chip">Soon</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="profile__action profile__action--soon profile__action--primary"
                  disabled
                >
                  Follow
                  <span className="profile__chip">Soon</span>
                </button>
              )}
            </div>
          </div>

          <dl className="profile__stats" aria-label="Profile stats">
            <div className="profile__stat">
              <dt>Posts</dt>
              <dd>{posts.length}</dd>
            </div>
            <div className="profile__stat-sep" aria-hidden="true" />
            <div className="profile__stat">
              <dt>Likes received</dt>
              <dd>{totalLikes}</dd>
            </div>
            {joined && (
              <>
                <div className="profile__stat-sep" aria-hidden="true" />
                <div className="profile__stat">
                  <dt>Joined</dt>
                  <dd>{joined}</dd>
                </div>
              </>
            )}
          </dl>
        </header>

        <section className="profile__posts">
          <div className="profile__posts-header">
            <h2 className="profile__posts-title">
              {isOwn ? 'Your posts' : 'Posts'}
            </h2>
            <span className="profile__posts-count">
              {posts.length} {posts.length === 1 ? 'dispatch' : 'dispatches'}
            </span>
          </div>

          {posts.length === 0 ? (
            <div className="profile__empty">
              <h3>Nothing posted yet</h3>
              <p>
                {isOwn
                  ? 'When you share something, it will live here.'
                  : `${user.name.split(' ')[0]} hasn't posted anything yet.`}
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <Post
                key={post._id}
                id={post._id}
                /* Profile posts are read-only — edit/delete live on the home feed. */
                isOwn={false}
                author={post.creator.name}
                authorAvatar={post.creator.avatarUrl}
                authorId={post.creator._id}
                date={new Date(post.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                title={post.title}
                image={post.imageUrl}
                content={post.content}
                likeCount={post.likeCount}
                likedByMe={post.likedByMe}
                commentCount={post.commentCount}
                token={this.props.token}
              />
            ))
          )}
        </section>
          </div>
        </div>
      </div>
    );
  }
}

export default Profile;
