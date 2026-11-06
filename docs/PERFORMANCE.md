# 3D board performance plan

Status: plan, started 2026-11-06. Runs alongside the triangle budget task (tools/tri-budget/, docs/RENDER-BUDGET.md). Numbers marked "from RENDER-BUDGET" get filled in when that task lands.

Goal: fights on the 3D board hold a steady frame rate on Vilhelm's iPhone through a whole match, with the look we have now or better.

## 1. Where we stand (read from main, 2026-11-06)

Already in place, keep it:

- Units are instanced. One InstancedMesh per model kind, look (solid / ghost / ghostFoe / glass) and material part (tint / team / fixed). A swarm of 12 costs the same draw calls as one body; only its triangles grow.
- Every small marker (health bars, rings, icons, labels) is one sprite draw call. Beams, flame fans and walls are batched too.
- Scenery: real models near the board, instanced impostor cards further out, blob shadows under impostors.
- The 3D board only draws during fights, while the camera moves, and shortly after a change.
- Quality setting: high (pixel ratio up to 2, shadows), medium (1.5, shadows), low (1, no shadows). A "too slow" rule drops to 2D for the visit. A speed meter (forced 3D) shows fps, slowest frame, live bodies and draw calls.

Likely costs (to be confirmed by measurement):

- Pixels: antialias (MSAA) on, pixel ratio 2 on high. Pixel work grows with the square of the ratio: 2 is 4x the pixels of 1, 1.5 is 2.25x.
- Materials: units, stones and walls use MeshStandardMaterial (physically based). It is the most expensive standard material per pixel. With roughness 0.6-0.75 and metalness 0.05-0.1 its extra look is small.
- Shadows: PCFSoftShadowMap at 2048, and every unit casts. The shadow pass draws every unit triangle a second time.
- Draw calls per frame grow with the number of different model kinds on the board (each up to 3 parts, times 2 with shadows). Skins count as their own kinds.

## 2. Rules (proposed)

R1. Triangle budget per squad, not per body. Max per body = squad budget / bodies, with a cap for one-body units and a floor for swarms. Tier 1 gets the tightest squad budget. Numbers: from RENDER-BUDGET.

R2. Three materials for units: tint, team, fixed. Colours go through instance colour or vertex colour. No per-unit materials or textures on unit models.

R3. Two lights: hemisphere + sun. Glows are faked: a bright unlit colour plus an additive sprite or beam. No point lights or spot lights in fights.

R4. No post-processing (bloom, depth of field, outlines as a pass) on the board in fights. Allowed in intros, menus and the Animation Lab.

R5. No transparent parts in unit models. Transparency only for the ghost and glass looks and effects.

R6. Effects go through the batched layers (sprites, beams, fans). No new mesh or material per effect instance. Each effect type has a cap per frame.

R7. Unit animation stays rigid: position, rotation, scale, bob, lean, roll. No skinned meshes on the board.

R8. New model kinds and skins are not free: each adds up to 3 draw calls (6 with shadows) whenever it is on the board. Prefer variants of an existing kind (colour, scale) where it reads well enough.

R9. Test target: a whole match on the reference iPhone (Vilhelm's), not the first 30 seconds. Phones throttle when warm. Target to decide after measuring, proposal: 60 fps on medium in a round-11 fight, never under 30 on low.

## 3. Tricks, in the order to try them

Each one goes behind a dev flag first (for example ?mat=lambert&dpr=1.5&shadow=blob&lod=1) so it can be A/B tested on the iPhone with the stress page from the triangle budget task, frame time and a screenshot for each.

T1. Cheaper unit material. Swap MeshStandardMaterial for MeshLambertMaterial on tint / team / fixed, stones and walls. Flat-shaded low-poly looks almost the same. Compare screenshots side by side at each camera level. Expected: a large cut in pixel cost, near-free visually.

T2. Resolution. Compare pixel ratio 2 vs 1.75 vs 1.5 with MSAA on. Flat-shaded models with MSAA usually look nearly the same at 1.5. Then dynamic resolution: when frames run over budget for a second, step the ratio down; step it back up when calm. The speed meter already measures frames, so it can drive this. Make "Auto" the default quality and keep high / medium / low as overrides. The 2D fallback stays as the last step.

T3. Shadows.
- Try PCFShadowMap (not soft) and 1024 vs 2048; tighten the shadow camera to the board.
- Blob shadows for small and swarm units (an instanced soft disc under each body, like the scenery impostors have). Real shadows only for big units, towers and buildings. A swarm then skips the shadow pass entirely.
- Medium quality gets blob shadows instead of real ones; low gets blobs instead of nothing. The units still sit on the ground, which is most of what shadows do here.

T4. Level of detail by camera level. Models are built from primitives with side counts, so a low version can be made automatically: fewer cylinder and cone sides, simpler balls, parts under about 0.15 m dropped. Use it in the strategic and tilted views, where a body is a few pixels tall. Group key gets a ':lo' suffix. Swarms benefit most.

T5. Free fake ambient occlusion. Enable vertexColors on the tint and team materials too (three multiplies vertex colour by instance colour) and bake a grey value per vertex: darker near the ground and in crevices, full brightness on top. Same for fixed parts. No runtime cost, models read more solid, especially with cheaper materials and blob shadows.

T6. Per-frame CPU. placeBodies rebuilds keyed lists and sets every instance colour each frame. Profile before touching it; only fix if the profile shows it (reuse arrays, set colours only when they change).

T7. Frame pacing. A steady 30 looks better than a frame rate jumping between 40 and 60. Option: cap fights at 30 on low. Check how Safari on the iPhone schedules frames on 120 Hz screens so we never draw more than 60.

## 4. Looking good cheaply (art rules)

- Silhouette and colour over detail. A unit should read from its outline at strategic zoom. Spend triangles on the parts that change the outline.
- Fewer, bigger parts. Merge or remove parts under about 0.08 m (the Model Forge already checks this).
- Fake glow (R3) and fake AO (T5) instead of lights and post-processing.
- Contact shadow under every unit, real or blob.
- Fog and a gradient sky give depth for free; keep them.
- Hero units, leaders and skins may spend more triangles (their own cap in RENDER-BUDGET), since there are few of them.

## 5. Order of work

1. Triangle budget task: done (docs/RENDER-BUDGET.md, see section 6).
2. Next Claude Code session: T0 (find the 65-77 ms hitches), then dev flags for T1-T3, run the A/B on the iPhone with the stress page and a real round-11 fight, write the results into section 6.
3. Adopt the winners. Auto quality as default.
4. Fake AO (T5). LOD (T4) only if a later measurement shows triangles matter.
5. Model Forge Game check: per-squad budget by body count done (Forge v12). Still to add: warnings for transparent parts or more than the three material groups.

## 6. Results

### Triangle budget (docs/RENDER-BUDGET.md, 2026-11-06)

- iPhone, quality High, worst fight looping in Meadow: 60 fps held at every step up to 714k unit triangles (4,624 a body, 1.1 M in the frame). The limit wasn't found.
- Budget: 500k unit triangles on the board, 11,900 a squad, max a body = 11,900 / bodies capped at 4,600, or 2,890 when the squad size isn't known. Today's worst board uses 26k (about 5%).
- Draw calls aren't the limit either: 95 on the iPhone, and bodies don't add calls.
- But 1-4% of frames go over 20 ms and the worst frame is 65-77 ms at every step, with the game's own models too. Those hitches don't come from unit triangles.
- Model Forge Game check updated to these numbers (Forge v12).

What changes in this plan:

- R1 is settled by the numbers above. Spending more triangles on units is fine.
- T4 (LOD) drops to last: triangles aren't the cost.
- New first step, T0: find the hitches. First check the stress page itself: it restarts the fight every 4 s, so some of the worst frames may be the loop restarts and not the game. Then on the iPhone, record frame times in a real fight with Safari's timeline (Web Inspector from a Mac, or a log of every frame over 20 ms with what happened that frame: new InstancedMesh groups when a group grows (group() rebuilds with cap * 2), shader compiles when a new kind or look appears for the first time, floor repaints, garbage collection). Likely fixes: warm up every model kind and look before the fight, give groups enough room at the start, avoid per-frame allocations.
- Then T1-T3 as planned, measured as p95/p99 and frames over 20 ms, not just average fps (the average is already 59+), and also at Medium and Low and in the closer camera views, which the budget runs didn't cover.
