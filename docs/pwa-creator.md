# PWA Creator

The PWA Creator is a tool built into the Local GPT plugin that allows you to create Progressive Web Apps (PWAs) directly from Obsidian, including on mobile devices.

## What is a PWA?

A Progressive Web App (PWA) is a web application that can be installed on any device and work offline. PWAs combine the best features of websites and native mobile apps.

## How to Use

### Creating a PWA

1. Open Obsidian's command palette (typically `Ctrl/Cmd + P`)
2. Search for "Create Progressive Web App"
3. Click on the command to open the PWA Creator modal

### Configuring Your PWA

The PWA Creator modal allows you to configure the following settings:

- **App Name**: The full name of your application (displayed in the browser)
- **Short Name**: A shorter name for the home screen (recommended 12 characters or less)
- **Description**: A brief description of what your app does
- **Theme Color**: The primary color of your app's UI (hex format, e.g., `#2196f3`)
- **Background Color**: The background color shown while your app loads (hex format, e.g., `#ffffff`)
- **Display Mode**: How your app should be displayed:
  - **Standalone** (Recommended): Looks like a native app
  - **Fullscreen**: Takes over the entire screen
  - **Minimal UI**: Shows minimal browser UI
  - **Browser**: Opens in a regular browser tab
- **Orientation**: The preferred screen orientation (Any, Natural, Landscape, or Portrait)

### Generated Files

When you create a PWA, the plugin generates a folder named `PWA-[YourShortName]` containing:

- `manifest.json`: PWA manifest file that describes your app
- `service-worker.js`: Handles offline functionality and caching
- `index.html`: Main HTML file with PWA setup
- `styles.css`: Basic stylesheet
- `script.js`: Application JavaScript file
- `README.md`: Instructions for deploying and using your PWA

### Adding Icons

Your PWA needs icon files to work properly. You'll need to add:

- `icon-192x192.png`: 192x192 pixel icon
- `icon-512x512.png`: 512x512 pixel icon

You can generate these icons using online tools like:
- [Real Favicon Generator](https://realfavicongenerator.net/)
- [PWA Builder](https://www.pwabuilder.com/)

### Deploying Your PWA

1. Copy all files from the generated folder to your web server
2. **Important**: Your server must serve files over HTTPS (PWAs require HTTPS)
3. Access your app via a web browser
4. Users can install the PWA from the browser menu

### Testing Your PWA

You can test your PWA using:

- **Chrome DevTools**: Open DevTools > Application tab > Manifest section
- **Lighthouse**: Run a Lighthouse audit in Chrome DevTools to check PWA compliance
- **Different Devices**: Test on various mobile and desktop devices

### Mobile Usage

The PWA Creator works great on mobile devices! You can create PWAs directly from Obsidian mobile:

1. Open Obsidian on your phone or tablet
2. Use the command palette to open "Create Progressive Web App"
3. Fill in your app details using the mobile-optimized interface
4. The PWA files will be created in your vault

### Customizing Your PWA

After creation, you can customize your PWA by editing the generated files:

- **index.html**: Modify the structure and content
- **styles.css**: Change the appearance
- **script.js**: Add your app's functionality
- **manifest.json**: Update app metadata
- **service-worker.js**: Adjust caching strategy

## Use Cases

The PWA Creator is perfect for:

- Creating simple tools and utilities that work offline
- Building personal productivity apps
- Prototyping app ideas quickly
- Learning about PWA development
- Creating mobile-accessible web applications

## Requirements

- Obsidian with Local GPT plugin installed
- A web server with HTTPS support for deployment
- Modern web browser for testing

## Troubleshooting

### PWA Won't Install

- Ensure your server uses HTTPS
- Check that manifest.json is properly formatted
- Verify icon files exist and are the correct sizes
- Check browser console for errors

### Service Worker Not Registering

- Confirm HTTPS is being used
- Check that service-worker.js is in the root directory
- Verify no JavaScript errors in the console
- Try clearing browser cache

### Icons Not Showing

- Ensure icon files are named correctly
- Verify icons are the right dimensions (192x192 and 512x512)
- Check that icon paths in manifest.json are correct

## Additional Resources

- [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Google PWA Documentation](https://web.dev/progressive-web-apps/)
- [PWA Builder](https://www.pwabuilder.com/)

## Support

For issues or questions about the PWA Creator, please file an issue on the [GitHub repository](https://github.com/pfrankov/obsidian-local-gpt).
