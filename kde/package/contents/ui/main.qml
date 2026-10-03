// Hosts the bundled wallpaper page (shanshui.html, made by kde/build.mjs) in a web view.
import QtQuick 2.15
import QtWebEngine 1.10

Item {
    id: root
    // a link copied from the demo panel, or just its "?…" query; empty = the defaults
    readonly property string settings: (wallpaper.configuration.Settings || "").trim()
    readonly property string query: settings.indexOf("?") >= 0 ? settings.slice(settings.indexOf("?"))
                                  : settings ? "?" + settings : ""

    WebEngineView {
        anchors.fill: parent
        // input goes to the desktop beneath (right-click menu, icons), not to the page
        enabled: false
        backgroundColor: "#f7deb8"
        settings.showScrollBars: false
        url: Qt.resolvedUrl("shanshui.html") + root.query
        onJavaScriptConsoleMessage: if (level > WebEngineView.InfoMessageLevel)
            console.warn("shanshui:", message, sourceID + ":" + lineNumber)
    }
}
