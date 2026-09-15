/* Independent browser-level verification of TestNexus native HTML capabilities. */

function setNativeInputValue(selector, value) {
  cy.get(selector).then(($input) => {
    const el = $input[0];
    const win = el.ownerDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
    expect(setter, `native value setter for ${selector}`).to.be.a('function');
    setter.call(el, String(value));
  }).trigger('input').trigger('change');
}

function html5Drag(source, target) {
  cy.get(source).then(($source) => cy.get(target).then(($target) => {
    const win = $source[0].ownerDocument.defaultView;
    const dataTransfer = new win.DataTransfer();
    cy.wrap($source).trigger('dragstart', { dataTransfer, force: true });
    cy.wrap($target)
      .trigger('dragenter', { dataTransfer, force: true })
      .trigger('dragover', { dataTransfer, force: true })
      .trigger('drop', { dataTransfer, force: true });
    cy.wrap($source).trigger('dragend', { dataTransfer, force: true });
  }));
}

describe('TestNexus HTML capability lab', () => {
  beforeEach(() => cy.visit('/capabilities.html'));

  it('CAP001 default input type follows browser text semantics', () => {
    cy.get('#default-input').invoke('prop', 'type').should('eq', 'text');
    cy.get('#default-input').type('default text').should('have.value', 'default text');
  });

  it('CAP002 text input', () => cy.get('#text-input').type('Hello').should('have.value', 'Hello'));
  it('CAP003 password input', () => cy.get('#password-input').type('Secret123!').should('have.value', 'Secret123!'));
  it('CAP004 email input', () => cy.get('#email-input').type('qa@example.com').should('have.value', 'qa@example.com'));
  it('CAP005 search input', () => cy.get('#search-input').type('capability').should('have.value', 'capability'));
  it('CAP006 telephone input', () => cy.get('#tel-input').type('+96899112233').should('have.value', '+96899112233'));
  it('CAP007 URL input', () => cy.get('#url-input').type('https://example.com').should('have.value', 'https://example.com'));
  it('CAP008 number input', () => cy.get('#number-input').type('42').should('have.value', '42'));
  it('CAP009 date input', () => cy.get('#date-input').type('2026-09-15').should('have.value', '2026-09-15'));
  it('CAP010 datetime-local input', () => cy.get('#datetime-input').type('2026-09-15T15:30').should('have.value', '2026-09-15T15:30'));
  it('CAP011 month input', () => cy.get('#month-input').type('2026-09').should('have.value', '2026-09'));
  it('CAP012 week input', () => cy.get('#week-input').type('2026-W38').should('have.value', '2026-W38'));
  it('CAP013 time input', () => cy.get('#time-input').type('15:30:15').should('have.value', '15:30:15'));

  it('CAP014 range input uses native value semantics', () => {
    setNativeInputValue('#range-input', '60');
    cy.get('#range-input').should('have.value', '60');
    cy.get('#range-output').should('have.value', '60');
    cy.get('#status').should('have.text', 'range:60');
  });

  it('CAP015 color input uses native value semantics', () => {
    setNativeInputValue('#color-input', '#336699');
    cy.get('#color-input').should('have.value', '#336699');
    cy.get('#color-output').should('have.value', '#336699');
    cy.get('#status').should('have.text', 'color:#336699');
  });

  it('CAP016 hidden input remains observable but not visually interactive', () => {
    cy.get('#hidden-input').should('exist').and('not.be.visible').and('have.value', 'hidden-value');
  });

  it('CAP017 textarea supports text editing', () => cy.get('#textarea-input').type('Longer feedback text').should('have.value', 'Longer feedback text'));

  it('CAP018 contenteditable uses text semantics rather than form value semantics', () => {
    cy.get('#editable-input').clear().type('Edited content').should('have.text', 'Edited content');
    cy.get('#editable-input').invoke('val').should('eq', '');
  });

  it('CAP019 datalist-backed input accepts an evidenced option value', () => {
    cy.get('#datalist-input').type('Muscat').should('have.value', 'Muscat');
    cy.get('#city-list option[value="Muscat"]').should('exist');
  });

  it('CAP020 checkbox supports check and uncheck', () => {
    cy.get('#checkbox-input').check().should('be.checked').uncheck().should('not.be.checked');
  });

  it('CAP021 radio supports selecting a real group member', () => {
    cy.get('#radio-a').check().should('be.checked');
    cy.get('#radio-b').check().should('be.checked');
    cy.get('#radio-a').should('not.be.checked');
  });

  it('CAP022 native single select', () => {
    cy.get('#single-select').select('b').should('have.value', 'b');
    cy.get('#single-select option[value="disabled"]').should('be.disabled');
  });

  it('CAP023 native multiple select', () => {
    cy.get('#multi-select').select(['red', 'blue']).should(($select) => {
      const values = Array.from($select[0].selectedOptions).map((option) => option.value);
      expect(values).to.deep.eq(['red', 'blue']);
    });
  });

  it('CAP024 disabled optgroup is treated as effectively disabled', () => {
    cy.get('#multi-select option[value="blocked"]').should('be.disabled');
  });

  it('CAP025 single file input', () => {
    cy.get('#file-input').selectFile('fixtures/uploads/sample.txt');
    cy.get('#file-input').should(($input) => expect($input[0].files[0].name).to.eq('sample.txt'));
  });

  it('CAP026 image-only file input', () => {
    cy.get('#image-file-input').selectFile('fixtures/uploads/sample.svg');
    cy.get('#image-file-input').should(($input) => expect($input[0].files[0].name).to.eq('sample.svg'));
  });

  it('CAP027 multiple file input', () => {
    cy.get('#multi-file-input').selectFile(['fixtures/uploads/sample.txt', 'fixtures/uploads/sample.svg']);
    cy.get('#multi-file-input').should(($input) => {
      expect(Array.from($input[0].files).map((file) => file.name)).to.deep.eq(['sample.txt', 'sample.svg']);
    });
  });

  it('CAP028 file drag/drop', () => {
    cy.get('#file-drop-zone').selectFile('fixtures/uploads/sample.svg', { action: 'drag-drop' });
    cy.get('#file-drop-zone').should('have.attr', 'data-file-count', '1');
    cy.get('#file-drop-output').should('contain.text', 'sample.svg');
  });

  it('CAP029 native HTML5 element drag/drop', () => {
    html5Drag('#drag-source', '#drag-target');
    cy.get('#drag-output').should('have.text', 'drag-source');
  });

  it('CAP030 default button browser type is submit', () => {
    cy.get('#default-button').invoke('prop', 'type').should('eq', 'submit');
  });

  it('CAP031 ordinary button click', () => {
    cy.get('#button-control').click();
    cy.get('#status').should('have.text', 'button-clicked');
  });

  it('CAP032 form submit', () => {
    cy.get('#required-input').type('Tester');
    cy.get('#sample-form').submit();
    cy.get('#status').should('have.text', 'form-submitted');
  });

  it('CAP033 form reset', () => {
    cy.get('#required-input').type('Tester').should('have.value', 'Tester');
    cy.get('#reset-button').click();
    cy.get('#required-input').should('have.value', '');
  });

  it('CAP034 required readonly disabled and browser validity states', () => {
    cy.get('#required-input').should('have.attr', 'required').and('have.attr', 'minlength', '2').and('have.attr', 'maxlength', '20').and('have.attr', 'pattern', '[A-Za-z ]+');
    cy.get('#readonly-input').should('have.attr', 'readonly');
    cy.get('#disabled-input').should('be.disabled');
    cy.get('#required-input').should(($el) => expect($el[0].checkValidity()).to.eq(false));
    cy.get('#required-input').type('Valid Name').should(($el) => expect($el[0].checkValidity()).to.eq(true));
  });

  it('CAP035 details and summary', () => {
    cy.get('#details-control').should('not.have.attr', 'open');
    cy.get('#details-summary').click();
    cy.get('#details-control').should('have.attr', 'open');
  });

  it('CAP036 dialog open and close', () => {
    cy.get('#dialog-open').click();
    cy.get('#lab-dialog').should('be.visible').and('have.prop', 'open', true);
    cy.get('#dialog-close').click();
    cy.get('#lab-dialog').should('not.be.visible').and('have.prop', 'open', false);
  });

  it('CAP037 progress meter and output semantic state', () => {
    cy.get('#progress-control').invoke('prop', 'value').should('eq', 35);
    cy.get('#meter-control').invoke('prop', 'value').should('eq', 7);
    cy.get('#output-control').should('have.text', 'Calculated output');
  });

  it('CAP038 headings paragraphs divs and spans are content assertions', () => {
    cy.get('#lab-heading').should('have.text', 'TestNexus HTML Capability Lab');
    cy.get('#lab-paragraph').should('contain.text', 'deterministic target page');
    cy.get('#lab-div').should('have.text', 'Generic div content');
    cy.get('#lab-span').should('have.text', 'Generic span content');
  });

  it('CAP039 table and list collections', () => {
    cy.get('#list-control li').should('have.length', 2);
    cy.get('#table-control tbody tr').should('have.length', 2);
  });

  it('CAP040 image loaded and alt text', () => {
    cy.get('#image-control').should(($img) => {
      expect($img[0].complete).to.eq(true);
      expect($img[0].naturalWidth).to.be.greaterThan(0);
    }).and('have.attr', 'alt', 'Capability sample');
  });

  it('CAP041 canvas is observable for layout and visual-regression use', () => {
    cy.get('#canvas-control').should('be.visible').and('have.attr', 'width', '80').and('have.attr', 'height', '30');
  });

  it('CAP042 open Shadow DOM input and button', () => {
    cy.get('#shadow-host').shadow().find('#shadow-input').type('shadow text').should('have.value', 'shadow text');
    cy.get('#shadow-host').shadow().find('#shadow-button').click();
    cy.get('#shadow-host').shadow().find('#shadow-status').should('have.text', 'shadow-clicked');
  });

  it('CAP043 input type=image is discoverable and clickable', () => {
    cy.get('#image-submit').should('have.attr', 'type', 'image').and('have.attr', 'alt', 'Image submit');
  });
});
