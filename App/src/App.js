import React, { Component, Fragment } from 'react';
import { Route, Switch, Redirect, withRouter } from 'react-router-dom';

import Layout from './components/Layout/Layout';
import Backdrop from './components/Backdrop/Backdrop';
import Toolbar from './components/Toolbar/Toolbar';
import MainNavigation from './components/Navigation/MainNavigation/MainNavigation';
import MobileNavigation from './components/Navigation/MobileNavigation/MobileNavigation';
import ErrorHandler from './components/ErrorHandler/ErrorHandler';
import FeedPage from './pages/Feed/Feed';
import SinglePostPage from './pages/Feed/SinglePost/SinglePost';
import ProfilePage from './pages/Profile/Profile';
import LoginPage from './pages/Auth/Login';
import SignupPage from './pages/Auth/Signup';
import { GRAPHQL_URL, AVATAR_UPLOAD_URL } from './config';
import './App.css';

class App extends Component {
  state = {
    showBackdrop: false,
    showMobileNav: false,
    isAuth: false,
    token: null,
    userId: null,
    currentUser: null,        // { _id, name, avatarUrl, status }
    authLoading: false,
    error: null,
    // Versioned post update broadcast by the modal SinglePost so the
    // underlying Feed / Profile can merge changes (likes, comment
    // counts) into their local post arrays without refetching.
    postUpdate: null,         // { postId, fields, version }
  };

  componentDidMount() {
    const token = localStorage.getItem('token');
    const expiryDate = localStorage.getItem('expiryDate');
    if (!token || !expiryDate) {
      return;
    }
    if (new Date(expiryDate) <= new Date()) {
      this.logoutHandler();
      return;
    }
    const userId = localStorage.getItem('userId');
    const remainingMilliseconds =
      new Date(expiryDate).getTime() - new Date().getTime();
    this.setState({ isAuth: true, token: token, userId: userId });
    this.fetchCurrentUser(token);
    this.setAutoLogout(remainingMilliseconds);
  }

  fetchCurrentUser = (token) => {
    const graphqlQuery = {
      query: '{ user { _id name avatarUrl status } }',
    };
    fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.data && data.data.user) {
          this.setState({ currentUser: data.data.user });
        }
      })
      .catch((err) => console.error('Failed to load current user', err));
  };

  handleUserUpdated = (partial) => {
    this.setState((prev) => ({
      currentUser: prev.currentUser ? { ...prev.currentUser, ...partial } : partial,
    }));
  };

  closePostModal = () => {
    // history.goBack pops the modal route off the stack and returns
    // us to whatever URL was the background.
    this.props.history.goBack();
  };

  /**
   * Broadcast a post-level change from the modal SinglePost so the
   * underlying Feed / Profile can merge it into their local posts.
   * Bumping `version` guarantees a new object identity even when the
   * same fields are updated multiple times for the same post.
   */
  handlePostUpdate = (postId, fields) => {
    this.setState((prev) => ({
      postUpdate: {
        postId,
        fields,
        version: (prev.postUpdate ? prev.postUpdate.version : 0) + 1,
      },
    }));
  };

  mobileNavHandler = (isOpen) => {
    this.setState({ showMobileNav: isOpen, showBackdrop: isOpen });
  };

  backdropClickHandler = () => {
    this.setState({ showBackdrop: false, showMobileNav: false, error: null });
  };

  logoutHandler = () => {
    this.setState({ isAuth: false, token: null, currentUser: null });
    localStorage.removeItem('token');
    localStorage.removeItem('expiryDate');
    localStorage.removeItem('userId');
  };

  loginHandler = (event, authData) => {
    event.preventDefault();
    this.setState({ authLoading: true });
    const graphqlQuery = {
      query: `
      query SignIn($email: String!, $password: String!){
        login(email: $email, password: $password){
          token
          userId
        }
      }
    `,
      variables: {
        email: authData.email,
        password: authData.password,
      },
    };
    fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })
      .then((res) => {
        return res.json();
      })
      .then((resData) => {
        console.log(resData.errors);
        if (resData.errors && resData.errors[0].status === 401) {
          throw new Error(resData.errors[0].message);
        }
        if (resData.errors) {
          throw new Error('Logging in failed.');
        }
        console.log(resData);
        this.setState({
          isAuth: true,
          token: resData.data.login.token,
          authLoading: false,
          userId: resData.data.login.userId,
        });
        localStorage.setItem('token', resData.data.login.token);
        localStorage.setItem('userId', resData.data.login.userId);
        const remainingMilliseconds = 60 * 60 * 1000;
        const expiryDate = new Date(
          new Date().getTime() + remainingMilliseconds
        );
        localStorage.setItem('expiryDate', expiryDate.toISOString());
        this.fetchCurrentUser(resData.data.login.token);
        this.setAutoLogout(remainingMilliseconds);
      })
      .catch((err) => {
        console.log(err);
        this.setState({
          isAuth: false,
          authLoading: false,
          error: err,
        });
      });
  };

  signupHandler = async (event, authData) => {
    event.preventDefault();
    this.setState({ authLoading: true });

    try {
      // If the user picked an avatar, upload it first and capture the URL.
      let avatarUrl = null;
      const avatarFile = authData.signupForm.avatar && authData.signupForm.avatar.value;
      if (avatarFile) {
        const formData = new FormData();
        formData.append('image', avatarFile);
        const uploadRes = await fetch(
          AVATAR_UPLOAD_URL,
          { method: 'POST', body: formData }
        );
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.message || 'Avatar upload failed.');
        avatarUrl = uploadData.filePath || null;
      }

      const graphqlQuery = {
        query: `
          mutation CreateNewUser($email: String!, $name: String!, $password: String!, $avatarUrl: String) {
            createUser(userInput: {email: $email, name: $name, password: $password, avatarUrl: $avatarUrl}) {
              _id
              email
            }
          }
        `,
        variables: {
          email: authData.signupForm.email.value,
          name: authData.signupForm.name.value,
          password: authData.signupForm.password.value,
          avatarUrl,
        },
      };

      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graphqlQuery),
      });
      const resData = await res.json();

      if (resData.errors && resData.errors[0].status === 422 && resData.errors[0].data) {
        throw new Error(resData.errors[0].data[0].message);
      }
      if (resData.errors && (resData.errors[0].status === 422 || resData.errors[0].status === 401)) {
        throw new Error(resData.errors[0].message);
      }
      if (resData.errors) throw new Error('Creating user failed.');

      this.setState({ isAuth: false, authLoading: false });
      this.props.history.replace('/');
    } catch (err) {
      console.log(err);
      this.setState({ isAuth: false, authLoading: false, error: err });
    }
  };

  setAutoLogout = (milliseconds) => {
    setTimeout(() => {
      this.logoutHandler();
    }, milliseconds);
  };

  errorHandler = () => {
    this.setState({ error: null });
  };

  render() {
    let routes = (
      <Switch>
        <Route
          path="/"
          exact
          render={(props) => (
            <LoginPage
              {...props}
              onLogin={this.loginHandler}
              loading={this.state.authLoading}
            />
          )}
        />
        <Route
          path="/signup"
          exact
          render={(props) => (
            <SignupPage
              {...props}
              onSignup={this.signupHandler}
              loading={this.state.authLoading}
            />
          )}
        />
        <Redirect to="/" />
      </Switch>
    );
    if (this.state.isAuth) {
      // Modal-as-route pattern: when a Link includes a `background`
      // location in its state, the main Switch renders against that
      // background URL (so the feed stays mounted) and the modal
      // route on top renders the actual destination as an overlay.
      const location = this.props.location;
      const background = location.state && location.state.background;

      routes = (
        <Fragment>
          <Switch location={background || location}>
            <Route
              path="/"
              exact
              render={(props) => (
                <FeedPage
                  {...props}
                  userId={this.state.userId}
                  token={this.state.token}
                  currentUser={this.state.currentUser}
                  onUserUpdated={this.handleUserUpdated}
                  postUpdate={this.state.postUpdate}
                />
              )}
            />
            <Route
              path="/p/:postId"
              render={(props) => (
                <SinglePostPage
                  {...props}
                  userId={this.state.userId}
                  token={this.state.token}
                  currentUser={this.state.currentUser}
                />
              )}
            />
            <Route
              path="/u/:userId"
              render={(props) => (
                <ProfilePage
                  {...props}
                  userId={this.state.userId}
                  token={this.state.token}
                  currentUser={this.state.currentUser}
                  postUpdate={this.state.postUpdate}
                />
              )}
            />
            <Redirect to="/" />
          </Switch>

          {/* Modal overlay — only mounts when a background location
              is preserved in router state (i.e. user clicked a post
              link from a different route, not via direct URL). */}
          {background && (
            <Fragment>
              <Backdrop onClick={this.closePostModal} />
              <Route
                path="/p/:postId"
                render={(props) => (
                  <SinglePostPage
                    {...props}
                    asModal
                    onClose={this.closePostModal}
                    userId={this.state.userId}
                    token={this.state.token}
                    currentUser={this.state.currentUser}
                    onPostUpdate={this.handlePostUpdate}
                  />
                )}
              />
            </Fragment>
          )}
        </Fragment>
      );
    }
    return (
      <Fragment>
        {this.state.showBackdrop && (
          <Backdrop onClick={this.backdropClickHandler} />
        )}
        <ErrorHandler error={this.state.error} onHandle={this.errorHandler} />
        <Layout
          header={
            <Toolbar>
              <MainNavigation
                onOpenMobileNav={this.mobileNavHandler.bind(this, true)}
                onLogout={this.logoutHandler}
                isAuth={this.state.isAuth}
                currentUser={this.state.currentUser}
              />
            </Toolbar>
          }
          mobileNav={
            <MobileNavigation
              open={this.state.showMobileNav}
              mobile
              onChooseItem={this.mobileNavHandler.bind(this, false)}
              onLogout={this.logoutHandler}
              isAuth={this.state.isAuth}
            />
          }
        >
          {routes}
        </Layout>
      </Fragment>
    );
  }
}

export default withRouter(App);
