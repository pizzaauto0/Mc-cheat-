package net.pizzaauto.cheatbridge.render;

import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;

import java.util.List;

/**
 * Zeichnet Umriss-Boxen fuer eine Liste von Blockpositionen (Xray/Storage-ESP).
 * Die Positionsliste wird periodisch in {@code CheatManager#scanWorld} aktualisiert,
 * hier wird nur noch gezeichnet -- daher pro Frame billig.
 */
public final class BlockEspRenderer {

    private BlockEspRenderer() {}

    public static void render(WorldRenderContext context, List<BlockPos> positions, float r, float g, float b, float alpha) {
        if (positions.isEmpty() || context.world() == null) return;

        Vec3d camPos = context.camera().getPos();
        VertexConsumer buffer = context.consumers().getBuffer(RenderLayers.lines());

        for (BlockPos pos : positions) {
            Box box = new Box(pos).offset(-camPos.x, -camPos.y, -camPos.z);
            WorldRenderer.drawBox(context.matrixStack(), buffer, box, r, g, b, alpha);
        }
    }
}
