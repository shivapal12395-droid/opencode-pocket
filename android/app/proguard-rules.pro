# Keep the rules minimal: the WebView content is our own bundled client and the
# native surface is small. Add rules here only if release minification is enabled.
-keep class com.shivapal.opencodepocket.** { *; }
-keepattributes *JavascriptInterface*
