package net.pizzaauto.cheatbridge.render;

import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.Entity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import net.pizzaauto.cheatbridge.CheatManager;

/**
 * Zeichnet Linien vom Spieler zu nahen Entities ("Tracer"), analog zu ESP aber als
 * Linie statt Box.
 */
public final class TracerRenderer {

    private static final double RANGE = 64.0;

    private TracerRenderer() {}

    public static void render(WorldRenderContext context, CheatManager cheats) {
        if (context.world() == null || context.player() == null) return;

        Vec3d camPos = context.camera().getPos();
        Vec3d origin = context.player().getEyePos().subtract(camPos);
        VertexConsumer buffer = context.consumers().getBuffer(RenderLayers.lines());
        Matrix4f matrix = context.matrixStack().peek().getPositionMatrix();

        Box searchBox = new Box(
                camPos.x - RANGE, camPos.y - RANGE, camPos.z - RANGE,
                camPos.x + RANGE, camPos.y + RANGE, camPos.z + RANGE
        );

        for (Entity entity : context.world().getOtherEntities(null, searchBox, e -> e instanceof PlayerEntity || e instanceof MobEntity)) {
            float r, g, b;
            if (entity instanceof PlayerEntity) {
                r = 1.0f; g = 0.25f; b = 0.25f;
            } else {
                r = 1.0f; g = 0.85f; b = 0.1f;
            }

            Vec3d target = entity.getBoundingBox().getCenter().subtract(camPos);
            drawLine(matrix, buffer, origin, target, r, g, b);
        }
    }

    private static void drawLine(Matrix4f matrix, VertexConsumer buffer, Vec3d from, Vec3d to, float r, float g, float b) {
        Vec3d dir = to.subtract(from).normalize();
        buffer.vertex(matrix, (float) from.x, (float) from.y, (float) from.z)
                .color(r, g, b, 0.8f)
                .normal((float) dir.x, (float) dir.y, (float) dir.z);
        buffer.vertex(matrix, (float) to.x, (float) to.y, (float) to.z)
                .color(r, g, b, 0.8f)
                .normal((float) dir.x, (float) dir.y, (float) dir.z);
    }
}
