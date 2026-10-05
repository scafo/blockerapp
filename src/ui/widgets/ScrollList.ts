import Phaser from 'phaser';

/**
 * Lista verticale con scorrimento (rotella o trascinamento), ritagliata nella finestra w×h.
 * Aggiungi le righe a `listBody` in coordinate locali dall'alto; chiama `setContentHeight` quando cambia il totale.
 */
export class ScrollList extends Phaser.GameObjects.Container {
  readonly listBody: Phaser.GameObjects.Container;
  private maskShape: Phaser.GameObjects.Graphics;
  private viewH: number;
  private contentH = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
    super(scene, x, y);
    this.viewH = h;
    this.listBody = scene.add.container(0, 0);
    const zone = scene.add.zone(0, 0, w, h).setOrigin(0).setInteractive();
    this.add([this.listBody, zone]);
    this.maskShape = scene.make.graphics({});
    this.refreshMask(w, h);
    this.listBody.setMask(this.maskShape.createGeometryMask());
    scene.add.existing(this);

    zone.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => this.scrollBy(-dy * 0.5));
    let dragStartY = 0, bodyStartY = 0;
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { dragStartY = p.y; bodyStartY = this.listBody.y; });
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) this.setScroll(bodyStartY + (p.y - dragStartY)); });
  }

  /** Richiama se sposti la lista con setPosition dopo averla creata (il ritaglio è in coordinate assolute). */
  refreshMask(w: number, h: number): void {
    this.maskShape.clear().fillStyle(0xffffff).fillRect(this.x, this.y, w, h);
  }

  setContentHeight(h: number): this {
    this.contentH = h;
    return this;
  }

  private setScroll(y: number): void {
    const min = Math.min(0, this.viewH - this.contentH);
    this.listBody.y = Phaser.Math.Clamp(y, min, 0);
  }

  scrollBy(dy: number): void {
    this.setScroll(this.listBody.y + dy);
  }
}
