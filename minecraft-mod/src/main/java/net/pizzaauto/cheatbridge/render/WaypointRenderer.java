package net.pizzaauto.cheatbridge.render;

import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.pizzaauto.cheatbridge.CheatManager;
import net.pizzaauto.cheatbridge.Waypoint;

/**
 * Zeichnet gesetzte Waypoints (per Taste, Standard "K") als vertikale Markierungsboxen.
 */
public final class WaypointRenderer {

    private WaypointRenderer() {}

    public static void render(WorldRenderContext context, CheatManager cheats) {
        if (context.world() == null || cheats.waypoints.isEmpty()) return;

        Vec3d camPos = context.camera().getPos();
        VertexConsumer buffer = context.consumers().getBuffer(RenderLayers.lines());

        for (Waypoint wp : cheats.waypoints) {
            Box box = new Box(
                    wp.x - 0.4, wp.y, wp.z - 0.4,
                    wp.x + 0.4, wp.y + 200.0, wp.z + 0.4
            ).offset(-camPos.x, -camPos.y, -camPos.z);

            WorldRenderer.drawBox(context.matrixStack(), buffer, box, 0.3f, 0.7f, 1.0f, 0.5f);
        }
    }
}
