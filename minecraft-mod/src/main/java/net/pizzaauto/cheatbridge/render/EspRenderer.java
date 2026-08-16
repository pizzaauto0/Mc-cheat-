package net.pizzaauto.cheatbridge.render;

import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.entity.Entity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.pizzaauto.cheatbridge.CheatManager;

/**
 * Zeichnet Umriss-Boxen um nahe Spieler/Mobs, damit sie (weitgehend) durch Waende
 * sichtbar sind. Nutzt den vanilla-Helfer {@link WorldRenderer#drawBox}, der bereits
 * fuer Debug-Hitboxen verwendet wird.
 */
public final class EspRenderer {

    private static final double RANGE = 64.0;

    private EspRenderer() {}

    public static void render(WorldRenderContext context, CheatManager cheats) {
        if (context.world() == null || context.gameRenderer().getCamera() == null) return;

        Vec3d camPos = context.camera().getPos();
        VertexConsumer buffer = context.consumers().getBuffer(RenderLayers.lines());

        Box searchBox = new Box(
                camPos.x - RANGE, camPos.y - RANGE, camPos.z - RANGE,
                camPos.x + RANGE, camPos.y + RANGE, camPos.z + RANGE
        );

        for (Entity entity : context.world().getOtherEntities(null, searchBox, e -> e instanceof PlayerEntity || e instanceof MobEntity)) {
            float r, g, b;
            if (entity instanceof PlayerEntity) {
                r = 1.0f; g = 0.25f; b = 0.25f; // Spieler: rot
            } else {
                r = 1.0f; g = 0.85f; b = 0.1f; // Mobs: gelb
            }

            Box box = entity.getBoundingBox().offset(-camPos.x, -camPos.y, -camPos.z);
            WorldRenderer.drawBox(context.matrixStack(), buffer, box, r, g, b, 0.9f);
        }
    }
}
