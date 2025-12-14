import { PWAConfig, PWAManifest } from "./pwaInterfaces";

/**
 * Generates a PWA manifest.json content from configuration
 */
export function generateManifest(config: PWAConfig): string {
	const manifest: PWAManifest = {
		name: config.name,
		short_name: config.shortName,
		description: config.description,
		theme_color: config.themeColor,
		background_color: config.backgroundColor,
		display: config.display,
		orientation: config.orientation,
		start_url: config.startUrl,
		scope: config.scope,
		icons: config.icons,
	};

	return JSON.stringify(manifest, null, 2);
}

/**
 * Generates a service worker content with basic caching strategy
 */
export function generateServiceWorker(cacheName?: string): string {
	const cacheNameValue = cacheName || "pwa-cache-v1";

	return `// Service Worker for PWA
const CACHE_NAME = '${cacheNameValue}';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
`;
}

/**
 * Generates HTML file with PWA setup
 */
export function generateIndexHTML(config: PWAConfig): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${config.description}">
  <meta name="theme-color" content="${config.themeColor}">
  <title>${config.name}</title>
  
  <!-- PWA Manifest -->
  <link rel="manifest" href="/manifest.json">
  
  <!-- Apple Touch Icon -->
  <link rel="apple-touch-icon" href="/icon-192x192.png">
  
  <!-- Styles -->
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app">
    <h1>${config.name}</h1>
    <p>${config.description}</p>
    <div id="install-prompt" style="display: none;">
      <button id="install-button">Install App</button>
    </div>
  </div>
  
  <script src="/script.js"></script>
  <script>
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registered:', registration);
        })
        .catch((error) => {
          console.log('Service Worker registration failed:', error);
        });
    }
    
    // Handle PWA install prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      document.getElementById('install-prompt').style.display = 'block';
    });
    
    document.getElementById('install-button')?.addEventListener('click', () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the install prompt');
          }
          deferredPrompt = null;
          document.getElementById('install-prompt').style.display = 'none';
        });
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Generates basic CSS file
 */
export function generateCSS(): string {
	return `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  padding: 20px;
  background-color: #f5f5f5;
}

#app {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

h1 {
  color: #333;
  margin-bottom: 20px;
}

p {
  color: #666;
  margin-bottom: 20px;
}

#install-prompt {
  margin-top: 20px;
  padding: 15px;
  background: #e3f2fd;
  border-radius: 4px;
}

#install-button {
  padding: 10px 20px;
  background: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

#install-button:hover {
  background: #1976d2;
}

@media (max-width: 600px) {
  body {
    padding: 10px;
  }
  
  #app {
    padding: 20px;
  }
}`;
}

/**
 * Generates basic JavaScript file
 */
export function generateJS(): string {
	return `// App JavaScript
console.log('PWA App loaded');

// Add your application logic here
`;
}

/**
 * Gets default PWA configuration
 */
export function getDefaultPWAConfig(): PWAConfig {
	return {
		name: "My Progressive Web App",
		shortName: "My PWA",
		description: "A Progressive Web App created with Local GPT PWA Creator",
		themeColor: "#2196f3",
		backgroundColor: "#ffffff",
		display: "standalone",
		orientation: "any",
		startUrl: "/",
		scope: "/",
		icons: [
			{
				src: "/icon-192x192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icon-512x512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
		],
	};
}
