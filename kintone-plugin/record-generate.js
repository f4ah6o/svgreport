(function () {
  'use strict';

  var PLUGIN_ID = kintone.$PLUGIN_ID;
  var config = kintone.plugin.app.getConfig(PLUGIN_ID);
  var apiBaseUrl = config.REPORT_API_BASE_URL || '';
  var apiToken = config.REPORT_API_TOKEN || '';

  if (!apiBaseUrl) {
    return;
  }

  function callApi(path, method, body) {
    var url = apiBaseUrl.replace(/\/$/, '') + path;
    var headers = {
      'Content-Type': 'application/json',
    };
    if (apiToken) {
      headers.Authorization = 'Bearer ' + apiToken;
    }

    return fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var message = (json && json.error) || 'API error';
          throw new Error(message);
        }
        return json;
      });
    });
  }

  function createButton(text) {
    var button = document.createElement('button');
    button.className = 'kintoneplugin-button-normal';
    button.textContent = text;
    button.style.marginLeft = '8px';
    return button;
  }

  function notify(message, isError) {
    var style = isError ? 'notification_error' : 'notification_success';
    kintone.app.record.setFieldShown('$id', true);
    kintone.app.record.setFieldShown('$revision', true);
    kintone.api(kintone.api.url('/k/v1/record/comment.json', true), 'POST', {
      app: kintone.app.getId(),
      record: kintone.app.record.getId(),
      comment: {
        text: message,
      },
      mentions: [],
    }).catch(function () {
      // Ignore comment post failures in client runtime.
    });
    window.alert(message);
    document.body.setAttribute('data-report-notify-style', style);
  }

  kintone.events.on('app.record.detail.show', function (event) {
    var space = kintone.app.record.getHeaderMenuSpaceElement();
    if (!space || space.querySelector('[data-report-generate-button]')) {
      return event;
    }

    callApi('/api/v1/apps/' + event.appId + '/template-actions', 'GET')
      .then(function (response) {
        var actions = response.actions || [];
        if (!actions.length) {
          return;
        }
        actions.forEach(function (action) {
          var button = createButton('帳票生成: ' + action.action_code);
          button.dataset.reportGenerateButton = action.action_code;
          button.addEventListener('click', function () {
            button.disabled = true;
            var payload = {
              schema: 'report-job/v1',
              app_id: event.appId,
              record_id: event.recordId,
              template_action_code: action.action_code,
              requested_by: kintone.getLoginUser().code || kintone.getLoginUser().name || 'unknown',
            };
            callApi('/api/v1/jobs', 'POST', payload)
              .then(function (result) {
                notify('帳票ジョブを投入しました: ' + result.job_id, false);
              })
              .catch(function (error) {
                notify('帳票ジョブ投入に失敗しました: ' + error.message, true);
              })
              .finally(function () {
                button.disabled = false;
              });
          });
          space.appendChild(button);
        });
      })
      .catch(function (error) {
        notify('帳票アクション取得に失敗しました: ' + error.message, true);
      });

    return event;
  });
})();

