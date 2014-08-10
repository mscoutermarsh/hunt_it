var gh = (function() {
  'use strict';

  var signin_button;
  var signout_button;
  var submit_product;
  var user_info_div;

  var tokenFetcher = (function() {
    var clientId = '4e3af48665445a6ed4816e100fa6dc2ee0320db1e0f749923f77eda269df8deb';
    var clientSecret = '';
    var redirectUri = 'https://' + chrome.runtime.id +
                      '.chromiumapp.org/provider_cb';
    var redirectRe = new RegExp(redirectUri + '[#\?](.*)');

    var access_token = null;

    return {
      getToken: function(interactive, callback) {
        // In case we already have an access_token cached, simply return it.
        if (access_token) {
          callback(null, access_token);
          return;
        }

        var options = {
          'interactive': interactive,
          url:'https://api.producthunt.com/v1/oauth/authorize?client_id=' + clientId +
              '&response_type=code' +
              '&scope=public+private' +
              '&redirect_uri=' + encodeURIComponent(redirectUri)
        }
        chrome.identity.launchWebAuthFlow(options, function(redirectUri) {
          console.log('launchWebAuthFlow completed', chrome.runtime.lastError,
              redirectUri);

          if (chrome.runtime.lastError) {
            callback(new Error(chrome.runtime.lastError));
            return;
          }

          // Upon success the response is appended to redirectUri, e.g.
          // https://{app_id}.chromiumapp.org/provider_cb#access_token={value}
          //     &refresh_token={value}
          // or:
          // https://{app_id}.chromiumapp.org/provider_cb#code={value}
          var matches = redirectUri.match(redirectRe);
          if (matches && matches.length > 1)
            handleProviderResponse(parseRedirectFragment(matches[1]));
          else
            callback(new Error('Invalid redirect URI'));
        });

        function parseRedirectFragment(fragment) {
          var pairs = fragment.split(/&/);
          var values = {};

          pairs.forEach(function(pair) {
            var nameval = pair.split(/=/);
            values[nameval[0]] = nameval[1];
          });

          return values;
        }

        function handleProviderResponse(values) {
          console.log('providerResponse', values);
          if (values.hasOwnProperty('access_token'))
            setAccessToken(values.access_token);
          // If response does not have an access_token, it might have the code,
          // which can be used in exchange for token.
          else if (values.hasOwnProperty('code'))
            exchangeCodeForToken(values.code);
          else 
            callback(new Error('Neither access_token nor code avialable.'));
        }

        function exchangeCodeForToken(code) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST',
                   'https://api.producthunt.com/v1/oauth/token?'+
                   'client_id=' + clientId +
                   '&client_secret=' + clientSecret +
                   '&redirect_uri=' + redirectUri +
                   '&grant_type=authorization_code' +
                   '&code=' + code);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = function () {
            // When exchanging code for token, the response comes as json, which
            // can be easily parsed to an object.
            if (this.status === 200) {
              var response = JSON.parse(this.responseText);
              console.log(response);
              if (response.hasOwnProperty('access_token')) {
                setAccessToken(response.access_token);
              } else {
                callback(new Error('Cannot obtain access_token from code.'));
              }
            } else {
              console.log('code exchange status:', this.status);
              callback(new Error('Code exchange failed'));
            }
          };
          xhr.send();
        }

        function setAccessToken(token) {
          access_token = token;
          console.log('Setting access_token: ', access_token);
          callback(null, access_token);
        }
      },

      removeCachedToken: function(token_to_remove) {
        if (access_token == token_to_remove)
          access_token = null;
      }
    }
  })();

  function xhrWithAuth(method, url, interactive, callback) {
    var retry = true;
    var access_token;

    console.log('xhrWithAuth', method, url, interactive);
    getToken();

    function getToken() {
      tokenFetcher.getToken(interactive, function(error, token) {
        console.log('token fetch', error, token);
        if (error) {
          callback(error);
          return;
        }

        access_token = token;
        requestStart();
      });
    }

    function requestStart() {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + access_token);
      xhr.onload = requestComplete;
      xhr.send();
    }

    function requestComplete() {
      console.log('requestComplete', this.status, this.response);
      if ( ( this.status < 200 || this.status >=300 ) && retry) {
        retry = false;
        tokenFetcher.removeCachedToken(access_token);
        access_token = null;
        getToken();
      } else {
        callback(null, this.status, this.response);
      }
    }
  }

  function getUserInfo(interactive) {
    xhrWithAuth('GET',
                'https://api.producthunt.com/v1/me',
                interactive,
                onUserInfoFetched);
  }

  // Functions updating the User Interface:

  function showElement(element) {
    element.style.display = 'inline';
    element.disabled = false;
  }

  function hideElement(element) {
    element.style.display = 'none';
  }

  function disableButton(button) {
    button.disabled = true;
  }

  function onUserInfoFetched(error, status, response) {
    if (!error && status == 200) {
      console.log("Got the following user info: " + response);
      var user_info = JSON.parse(response).user;
      populateUserInfo(user_info);
      hideElement(signin_button);
      showElement(submit_product);
      showElement(signout_button);
    } else {
      console.log('infoFetch failed', error, status);
      showElement(signin_button);
    }
  }

  function populateUserInfo(user_info) {
    var elem = user_info_div;
    var nameElem = document.createElement('div');
    nameElem.innerHTML = "<b>Hello " + user_info.username + "</b><br>"
    elem.appendChild(nameElem);
  }

  function fetchUserRepos(repoUrl) {
    xhrWithAuth('GET', repoUrl, false, onUserReposFetched);
  }

  function onUserReposFetched(error, status, response) {
    var elem = document.querySelector('#user_repos');
    elem.value='';
    if (!error && status == 200) {
      console.log("Got the following user repos:", response);
      var user_repos = JSON.parse(response);
      user_repos.forEach(function(repo) {
        if (repo.private) {
          elem.value += "[private repo]";
        } else {
          elem.value += repo.name;
        }
        elem.value += '\n';
      });
    } else {
      console.log('infoFetch failed', error, status);
    }
  }

  // Handlers for the buttons's onclick events.

  function interactiveSignIn() {
    disableButton(signin_button);
    tokenFetcher.getToken(true, function(error, access_token) {
      if (error) {
        showElement(signin_button);
      } else {
        getUserInfo(true);
      }
    });
  }

  function revokeToken() {
    user_info_div.textContent = '';
    hideElement(signout_button);
    hideElement(submit_product);
    showElement(signin_button);
  }

  return {
    onload: function () {
      signin_button = document.querySelector('#signin');
      submit_product = document.querySelector('#submit_product');
      hideElement(submit_product)
      signin_button.onclick = interactiveSignIn;

      signout_button = document.querySelector('#signout');
      signout_button.onclick = revokeToken;

      user_info_div = document.querySelector('#user_info');

      console.log(signin_button, signout_button, user_info_div);
      // showElement(signin_button);
      getUserInfo(false);
    }
  };
})();


window.onload = gh.onload;
