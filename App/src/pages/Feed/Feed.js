import React, { Component } from 'react';

import Post from '../../components/Feed/Post/Post';
import FeedEdit from '../../components/Feed/FeedEdit/FeedEdit';
import Paginator from '../../components/Paginator/Paginator';
import PostSkeleton from '../../components/Skeleton/PostSkeleton';
import Skeleton from '../../components/Skeleton/Skeleton';
import ErrorHandler from '../../components/ErrorHandler/ErrorHandler';
import Sidebar from '../../components/Sidebar/Sidebar';
import { Plus } from '../../components/Icons/Icons';
import { GRAPHQL_URL, POST_IMAGE_URL } from '../../config';
import './Feed.css';

class Feed extends Component {
  state = {
    isEditing: false,
    posts: [],
    totalPosts: 0,
    editPost: null,
    postPage: 1,
    postsLoading: true,
    editLoading: false,
  };

  componentDidMount() {
    this.loadPosts();
  }

  componentDidUpdate(prevProps) {
    // Merge post-level updates broadcast from the modal SinglePost
    // (likes / comment counts) so the feed reflects them when the
    // modal closes without a full refetch. Versioned so repeat updates
    // for the same post still trigger.
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

  loadPosts = (direction) => {
    if (direction) {
      this.setState({ postsLoading: true, posts: [] });
    }
    let page = this.state.postPage;
    if (direction === 'next') {
      page++;
      this.setState({ postPage: page });
    }
    if (direction === 'previous') {
      page--;
      this.setState({ postPage: page });
    }

    const graphqlQuery = {
      query: `
        query FetchPosts($page: Int) {
          getPosts(page: $page) {
            posts {
              _id
              title
              content
              creator {
                _id
                name
                avatarUrl
              }
              imageUrl
              createdAt
              likeCount
              likedByMe
              commentCount
          }
            totalPosts
        }
      }
      `,
      variables: {
        page: page, //Using vairables keyword to pass page as a dynamic variable to the query
      },
    };
    fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.props.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })
      .then((res) => {
        return res.json();
      })
      .then((resData) => {
        if (resData.errors && resData.errors.status === 401) {
          throw new Error(resData.errors.message);
        }

        if (resData.errors) {
          throw new Error('Fetching posts failed.');
        }
        this.setState({
          posts: resData.data.getPosts.posts.map((post) => {
            return {
              ...post,
              imagePath: post.imageUrl,
            };
          }),
          totalPosts: resData.data.getPosts.totalPosts,
          postsLoading: false,
        });
      })
      .catch(this.catchError);
  };

  newPostHandler = () => {
    this.setState({ isEditing: true });
  };

  startEditPostHandler = (postId) => {
    this.setState((prevState) => {
      const loadedPost = { ...prevState.posts.find((p) => p._id === postId) };

      return {
        isEditing: true,
        editPost: loadedPost,
      };
    });
  };

  cancelEditHandler = () => {
    this.setState({ isEditing: false, editPost: null });
  };

  finishEditHandler = (postData) => {
    this.setState({
      editLoading: true,
    });
    const formData = new FormData();
    formData.append('image', postData.image);
    if (this.state.editPost) {
      formData.append('oldPath', this.state.editPost.imagePath);
    }
    fetch(POST_IMAGE_URL, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + this.props.token,
      },
      body: formData,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.message || 'Image upload failed.');
        }
        return body;
      })
      .then((fileResData) => {
        // No new file uploaded (e.g. edit with no image change) → keep existing
        const imageUrl = fileResData.filePath || 'undefined';
        let graphqlQuery = {
          query: `
            mutation CreateNewPost($title: String!, $content: String!, $imageUrl: String!){
              createPost(postInput: {title: $title, content: $content, imageUrl: $imageUrl}) {
              _id
              title
              content
              imageUrl
              creator  {
                _id
                name
                avatarUrl
              }
              createdAt
              likeCount
              likedByMe
              commentCount
            }
          }
          `,
          variables: {
            title: postData.title,
            content: postData.content,
            imageUrl: imageUrl,
          },
        };

        if (this.state.editPost) {
          graphqlQuery = {
            query: `
            mutation UpdateExistingPost($postId: ID!, $title: String!, $content: String!, $imageUrl: String!) {
              updatePost(id: $postId, postInput: {title: $title,
              content: $content
              imageUrl: $imageUrl}) {
              _id
              title
              content
              imageUrl
              creator  {
                _id
                name
                avatarUrl
              }
              createdAt
              likeCount
              likedByMe
              commentCount
            }
          }
          `,
            variables: {
              postId: this.state.editPost._id,
              title: postData.title,
              content: postData.content,
              imageUrl: imageUrl,
            },
          };
        }

        return fetch(GRAPHQL_URL, {
          method: 'POST',
          body: JSON.stringify(graphqlQuery),
          headers: {
            Authorization: 'Bearer ' + this.props.token,
            'Content-Type': 'application/json',
          },
        });
      })
      .then((res) => {
        console.log(res);
        return res.json();
      })
      .then((resData) => {
        let resDataField = 'createPost';
        if (this.state.editPost) {
          resDataField = 'updatePost';
        }

        if (
          resData.errors &&
          resData.errors[0].status === 422 &&
          resData.errors[0].data
        ) {
          throw new Error(resData.errors[0].data[0].message);
        }
        if (
          resData.errors &&
          (resData.errors[0].status === 422 ||
            resData.errors[0].status === 403 ||
            resData.errors[0].status === 404)
        ) {
          throw new Error(resData.errors[0].message);
        }
        if (resData.errors && resDataField === 'createPost') {
          throw new Error('Creating post failed.');
        }
        if (resData.errors && resDataField === 'updatePost') {
          throw new Error('Updating post failed.');
        }

        const post = {
          _id: resData.data[resDataField]._id,
          title: resData.data[resDataField].title,
          content: resData.data[resDataField].content,
          creator: resData.data[resDataField].creator,
          createdAt: resData.data[resDataField].createdAt,
          imageUrl: resData.data[resDataField].imageUrl,
          imagePath: resData.data[resDataField].imageUrl,
          likeCount: resData.data[resDataField].likeCount,
          likedByMe: resData.data[resDataField].likedByMe,
          commentCount: resData.data[resDataField].commentCount,
        };
        this.setState((prevState) => {
          let updatedPosts = [...prevState.posts];
          let updatedTotalPosts = prevState.totalPosts;
          if (prevState.editPost) {
            const postIndex = prevState.posts.findIndex(
              (p) => p._id === prevState.editPost._id
            );
            updatedPosts[postIndex] = post;
          } else {
            updatedTotalPosts++;
            if (prevState.posts.length >= 2) {
              updatedPosts.pop();
            }
            updatedPosts.unshift(post);
          }
          return {
            posts: updatedPosts,
            isEditing: false,
            editPost: null,
            editLoading: false,
            totalPosts: updatedTotalPosts,
          };
        });
      })
      .catch((err) => {
        console.error(err);
        this.setState({ editLoading: false, error: err });
      });
  };

  deletePostHandler = (postId) => {
    this.setState({ postsLoading: true });
    const graphqlQuery = {
      query: `
        mutation PostDelete($postId: ID!) {
          deletePost(id: $postId)
        }
      `,
      variables: {
        postId: postId,
      },
    };
    fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.props.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })
      .then((res) => {
        return res.json();
      })
      .then((resData) => {
        if (
          resData.errors &&
          (resData.errors[0].status === 401 ||
            resData.errors[0].status === 403 ||
            resData.errors[0].status === 404)
        ) {
          throw new Error(resData.errors[0].message);
        }
        if (resData.errors) {
          throw new Error('Post deletion failed.');
        }
        console.log(resData);
        this.loadPosts();
        // this.setState((prevState) => {
        //   const updatedPosts = prevState.posts.filter((p) => p._id !== postId);
        //   return { posts: updatedPosts, postsLoading: false };
        // });
      })
      .catch((err) => {
        console.log(err);
        this.setState({ postsLoading: false });
      });
  };

  errorHandler = () => {
    this.setState({ error: null });
  };

  catchError = (error) => {
    this.setState({ error: error });
  };

  render() {
    return (
      <div className="app-page">
        <ErrorHandler error={this.state.error} onHandle={this.errorHandler} />
        <FeedEdit
          editing={this.state.isEditing}
          selectedPost={this.state.editPost}
          loading={this.state.editLoading}
          onCancelEdit={this.cancelEditHandler}
          onFinishEdit={this.finishEditHandler}
        />

        <div className="app-page__sidebar">
          <Sidebar
            currentUser={this.props.currentUser}
            postCount={this.state.totalPosts}
            postsLoading={this.state.postsLoading}
          />
        </div>

        <div className="app-page__main">
        {!this.props.currentUser ? (
          <div className="feed__composer feed__composer--skeleton" aria-busy="true">
            <Skeleton variant="circle" width="2.4rem" height="2.4rem" />
            <Skeleton variant="text" height="2rem" radius="999px" />
            <Skeleton width="4.5rem" height="2rem" radius="999px" />
          </div>
        ) : (
          <button
            type="button"
            className="feed__composer"
            onClick={this.newPostHandler}
            aria-label="Create a new post"
          >
            <span className="feed__composer-avatar" aria-hidden="true">
              {this.props.currentUser.avatarUrl ? (
                <img src={this.props.currentUser.avatarUrl} alt="" />
              ) : (
                (this.props.currentUser.name || 'Y')
                  .trim()
                  .charAt(0)
                  .toUpperCase()
              )}
            </span>
            <span className="feed__composer-prompt">
              What&rsquo;s on your mind
              {this.props.currentUser.name
                ? `, ${this.props.currentUser.name.trim().split(/\s+/)[0]}`
                : ''}
              ?
            </span>
            <span className="feed__composer-cta" aria-hidden="true">
              <span className="feed__composer-cta-icon"><Plus size={14} /></span>
              <span className="feed__composer-cta-label">Post</span>
            </span>
          </button>
        )}

        <section className="feed">
          {this.state.postsLoading && (
            <>
              <PostSkeleton />
              <PostSkeleton />
            </>
          )}
          {this.state.posts.length <= 0 && !this.state.postsLoading ? (
            <div className="feed__empty">
              <h3 className="feed__empty-title">No posts yet</h3>
              <p>Be the first to share something.</p>
            </div>
          ) : null}
          {!this.state.postsLoading && this.state.posts.length > 0 && (
            <Paginator
              onPrevious={this.loadPosts.bind(this, 'previous')}
              onNext={this.loadPosts.bind(this, 'next')}
              lastPage={Math.ceil(this.state.totalPosts / 2)}
              currentPage={this.state.postPage}
            >
              {this.state.posts.map((post) => (
                <Post
                  key={post._id}
                  id={post._id}
                  isOwn={post.creator._id === this.props.userId}
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
                  onStartEdit={this.startEditPostHandler.bind(this, post._id)}
                  onDelete={this.deletePostHandler.bind(this, post._id)}
                />
              ))}
            </Paginator>
          )}
        </section>
        </div>
      </div>
    );
  }
}

export default Feed;
