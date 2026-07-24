import React from 'react';
import ReactDOM from 'react-dom';

import Button from '../Button/Button';
import './Modal.css';

const modal = props =>
  ReactDOM.createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header className="modal__header">
        <h1 id="modal-title" className="modal__title">{props.title}</h1>
        <button
          type="button"
          className="modal__close"
          onClick={props.onCancelModal}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div className="modal__content">{props.children}</div>

      <div className="modal__actions">
        {!props.hideCancel && (
          <Button mode="flat" onClick={props.onCancelModal}>
            Cancel
          </Button>
        )}
        <Button
          mode="raised"
          design="accent"
          onClick={props.onAcceptModal}
          disabled={!props.acceptEnabled}
          loading={props.isLoading}
        >
          {props.acceptLabel || 'Save'}
        </Button>
      </div>
    </div>,
    document.getElementById('modal-root')
  );

export default modal;
