/**
 * TODOアプリ サービスワーカー ( sw.js )
 * 
 * 主な役割:
 * - プッシュ通知の受信 (push イベント)
 * - 通知クリック時の挙動制御 (notificationclick イベント)
 */

self.addEventListener('push', function(event) {
    if (!event.data) return;

    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: '通知', body: event.data.text() };
    }

    const options = {
        body: data.body || '新しい通知があります',
        icon: data.icon || '/favicon.ico',
        badge: data.badge || '/favicon.ico',
        data: data.data || { url: '/' },
        vibrate: [100, 50, 100],
        actions: [
            { action: 'open', title: 'アプリを開く' },
            { action: 'close', title: '閉じる' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'TODOアプリ', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // すでに開いているウィンドウがあればフォーカス、なければ新規オープン
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url.pathname === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
