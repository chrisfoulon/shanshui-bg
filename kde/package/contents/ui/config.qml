// Wallpaper settings: paste a link from the demo's settings panel (its "Link" field).
import QtQuick 2.15
import QtQuick.Controls 2.15 as QQC2
import QtQuick.Layouts 1.15
import org.kde.kirigami 2.20 as Kirigami

Kirigami.FormLayout {
    property alias cfg_Settings: field.text

    QQC2.TextField {
        id: field
        Kirigami.FormData.label: "Settings link:"
        Layout.fillWidth: true
        placeholderText: "empty = defaults; paste a link from the demo panel"
    }
    QQC2.Label {
        Layout.fillWidth: true
        wrapMode: Text.Wrap
        text: "Tune the look in the demo (see the README: node bench/serve.mjs, then http://127.0.0.1:8765/demo/), open its panel with P, copy the link and paste it here. Remove seed= for a new landscape on each login."
    }
}
