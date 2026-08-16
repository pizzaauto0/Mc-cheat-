package net.pizzaauto.cheatbridge.render;

import net.minecraft.client.render.RenderLayer;

/**
 * Gemeinsamer RenderLayer fuer ESP/Tracer-Linien.
 *
 * ACHTUNG / bekannter Unsicherheitsfaktor: Mojang hat die Render-Pipeline in neueren
 * 1.21.x-Versionen mehrfach umgebaut. {@link RenderLayer#getLines()} ist der stabilste,
 * lange existierende vanilla Layer fuer Linien -- er nutzt allerdings normalen
 * Tiefentest, ESP/Tracer sind also nur teilweise "durch Waende" sichtbar (z.B. an
 * Kanten/Luecken), nicht komplett wandtransparent. Fuer echtes X-Ray-Rendering ohne
 * Tiefentest muss hier ein eigener Layer per RenderLayer.of(...) mit deaktiviertem
 * Depth-Test gebaut werden -- die genaue Signatur haengt von der exakten 1.21.11-API
 * ab, die sich zum Zeitpunkt dieses Codes nicht kompilieren liess. Beim ersten
 * `./gradlew build` gegen die echten Mappings ist das der wahrscheinlichste Punkt,
 * an dem eine kleine Anpassung noetig ist.
 */
public final class RenderLayers {

    private RenderLayers() {}

    public static RenderLayer lines() {
        return RenderLayer.getLines();
    }
}
