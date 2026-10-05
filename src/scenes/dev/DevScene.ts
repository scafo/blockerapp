import Phaser from 'phaser';
import { PALETTE } from '../../config/palette';
import { textStyle } from '../../ui/style';
import { view, uiCamera, anchors } from '../../ui/screen';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/widgets/Panel';
import { Drawer } from '../../ui/widgets/Drawer';
import { attachTooltip } from '../../ui/widgets/Tooltip';
import { Segmented } from '../../ui/widgets/Segmented';
import { Tabs } from '../../ui/widgets/Tabs';
import { Toasts } from '../../ui/widgets/Toasts';
import { ProgressBar } from '../../ui/widgets/ProgressBar';
import { Badge } from '../../ui/widgets/Badge';
import { ConfirmDialog } from '../../ui/widgets/ConfirmDialog';
import { costChips } from '../../ui/widgets/CostChips';
import { ScrollList } from '../../ui/widgets/ScrollList';
import { drawTable } from '../../ui/widgets/Table';
import { pushLevel } from '../../ui/hotkeys';
import { askName } from '../../ui/nameInput';

/** Galleria di ogni widget condiviso, in ogni stato: raggiungibile solo con ?debug=widgets, per il controllo visivo. */
export class DevScene extends Phaser.Scene {
  constructor() {
    super('Dev');
  }

  create() {
    uiCamera(this);
    const { width } = view(this);
    const A = anchors(this);
    this.cameras.main.setBackgroundColor(PALETTE.inchiostro);
    this.add.text(A.x0, A.y0, 'GALLERIA WIDGET — ?debug=widgets', textStyle(16, PALETTE.ocra));

    let y = A.y0 + 40;
    const label = (text: string) => { this.add.text(A.x0, y, text, textStyle(11, PALETTE.tenue, false)); y += 20; };
    const gap = (n = 24) => { y += n; };

    // Panel
    label('Panel (semplice · titolo · accento)');
    new Panel(this, 160, 60).setPosition(A.x0, y);
    new Panel(this, 160, 60, { title: 'Scheda' }).setPosition(A.x0 + 176, y);
    new Panel(this, 160, 60, { title: 'Scheda', accent: true }).setPosition(A.x0 + 352, y);
    gap(76);

    // Button
    label('Button (normale · primario · disabilitato+motivo · con tasto rapido)');
    new Button(this, 'NORMALE', 120, 40, () => {}).setPosition(A.x0, y);
    new Button(this, 'PRIMARIO', 120, 40, () => {}, 16).setPosition(A.x0 + 136, y).setPrimary();
    new Button(this, 'BLOCCATO', 140, 40, () => {}).setPosition(A.x0 + 272, y).setDisabled(true, 'Serve più metallo');
    new Button(this, 'GIOCA', 120, 40, () => {}, 16, { hotkey: 'G' }).setPosition(A.x0 + 428, y);
    gap(56);

    // Segmented + Tabs
    label('Segmented · Tabs');
    new Segmented(this, 220, 36, ['10 MIN', '20 MIN', '30 MIN'], 1, () => {}).setPosition(A.x0, y);
    new Tabs(this, 220, 36, ['SCAMBIO', 'RIFORNIM.', 'ACCELERA'], 0, () => {}).setPosition(A.x0 + 244, y);
    gap(52);

    // ProgressBar + Badge
    label('ProgressBar (vari stati) · Badge');
    new ProgressBar(this, 160, 10, PALETTE.ocra).setProgress(0.7).setPosition(A.x0, y);
    new ProgressBar(this, 160, 10, PALETTE.radioattivo).setProgress(0.3).setPosition(A.x0, y + 16);
    new ProgressBar(this, 160, 10, PALETTE.ko).setProgress(0.95).setPosition(A.x0, y + 32);
    new Badge(this, PALETTE.radioattivo).setPosition(A.x0 + 190, y + 6);
    new Badge(this, PALETTE.ocra, '3').setPosition(A.x0 + 220, y + 6);
    new Badge(this, PALETTE.ko, '12').setPosition(A.x0 + 250, y + 6);
    gap(64);

    // CostChips + Table
    label('CostChips (ok · manca) · Table');
    costChips(this, A.x0, y, { metallo: 40, cibo: 120 }, { metallo: 20, cibo: 200, benzina: 0 });
    drawTable(this, A.x0 + 200, y + 12, 140,
      [{ k: 'VITA', v: '80/100', c: PALETTE.radioattivo }, { k: 'STATO', v: 'in marcia' }]);
    gap(52);

    // Toasts
    label('Toasts');
    const toasts = new Toasts(this, width / 2, view(this).height - 60);
    new Button(this, 'INFO', 90, 32, () => toasts.show('Messaggio', 'info'), 12).setPosition(A.x0, y);
    new Button(this, 'OK', 90, 32, () => toasts.show('Fatto', 'ok'), 12).setPosition(A.x0 + 98, y);
    new Button(this, 'AVVISO', 90, 32, () => toasts.show('Attenzione', 'warn'), 12).setPosition(A.x0 + 196, y);
    gap(48);

    // Tooltip
    label('Tooltip (passa il mouse)');
    const tip = this.add.rectangle(A.x0 + 10, y + 10, 160, 32, PALETTE.pannello, 1).setStrokeStyle(1, PALETTE.linea).setInteractive();
    this.add.text(A.x0 + 10, y + 10, 'passa qui sopra', textStyle(11, PALETTE.tenue, false)).setOrigin(0.5);
    attachTooltip(this, tip, 'Questo è un fumetto');
    gap(48);

    // ConfirmDialog + Drawer
    label('ConfirmDialog · Drawer · nome (campo HTML)');
    new Button(this, 'CONFERMA…', 140, 36, () => {
      new ConfirmDialog(this, width, view(this).height, 'Sei sicuro?', 'Questa azione non si può annullare.', 'CONFERMA', () => {});
    }, 13).setPosition(A.x0, y);
    new Button(this, 'CASSETTO…', 140, 36, () => {
      const d = new Drawer(this, width, view(this).height, 320, { title: 'Dettaglio' });
      d.content.add(this.add.text(16, 60, 'Contenuto del cassetto.', textStyle(12, PALETTE.carta, false)));
    }, 13).setPosition(A.x0 + 152, y);
    new Button(this, 'NOME…', 140, 36, () => askName('IL TUO NOME', 'Nico', () => {}), 13).setPosition(A.x0 + 304, y);
    gap(52);

    // ScrollList
    label('ScrollList (rotella/trascina)');
    const list = new ScrollList(this, A.x0, y, 220, 100).setContentHeight(20 * 26);
    for (let i = 0; i < 20; i++) {
      list.listBody.add(this.add.text(8, i * 26 + 10, `Riga ${i + 1}`, textStyle(11, PALETTE.carta, false)));
    }
    this.add.rectangle(A.x0, y, 220, 100).setStrokeStyle(1, PALETTE.linea).setOrigin(0);

    // verifica scorciatoie: G non deve attivarsi mentre si scrive nel campo nome (prova a scrivere in NOME…, poi premi G)
    pushLevel({ g: () => toasts.show('tasto G', 'ok') });
  }
}
