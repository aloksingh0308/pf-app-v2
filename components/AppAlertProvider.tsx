import { AppAlertButton, setGlobalAlertHandler } from '@/services/alertService';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from 'react-native';
import styled from 'styled-components/native';

type AlertState = {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
};

const DEFAULT_STATE: AlertState = {
  visible: false,
  title: '',
  message: '',
  buttons: [{ text: 'OK' }],
};

export default function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [alertState, setAlertState] = useState<AlertState>(DEFAULT_STATE);

  useEffect(() => {
    setGlobalAlertHandler((title, message, buttons) => {
      setAlertState({
        visible: true,
        title,
        message,
        buttons: buttons?.length ? buttons : [{ text: 'OK' }],
      });
    });

    return () => setGlobalAlertHandler(null);
  }, []);

  const closeAlert = () => {
    setAlertState((prev) => ({ ...prev, visible: false }));
  };

  const mappedButtons = useMemo(() => alertState.buttons || [{ text: 'OK' }], [alertState.buttons]);
  const isTwoButtonLayout = mappedButtons.length === 2;

  return (
    <>
      {children}
      <Modal visible={alertState.visible} transparent animationType="fade" onRequestClose={closeAlert}>
        <Overlay>
          <Card>
            <Content>
              <AlertTitle>{alertState.title}</AlertTitle>
              {!!alertState.message && <AlertMessage>{alertState.message}</AlertMessage>}
            </Content>

            <ActionsContainer twoColumn={isTwoButtonLayout}>
              {mappedButtons.map((button, index) => (
                <ActionButton
                  key={`${button.text}-${index}`}
                  twoColumn={isTwoButtonLayout}
                  addLeftBorder={isTwoButtonLayout && index > 0}
                  addTopBorder={!isTwoButtonLayout && index > 0}
                  onPress={() => {
                    closeAlert();
                    button.onPress?.();
                  }}
                >
                  <ActionText
                    destructive={button.style === 'destructive'}
                    cancel={button.style === 'cancel'}
                  >
                    {button.text}
                  </ActionText>
                </ActionButton>
              ))}
            </ActionsContainer>
          </Card>
        </Overlay>
      </Modal>
    </>
  );
}

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.34);
  justify-content: center;
  align-items: center;
  padding: 24px;
`;

const Card = styled.View`
  width: 270px;
  background-color: #f2f2f7;
  border-radius: 14px;
  overflow: hidden;
`;

const Content = styled.View`
  padding: 18px 16px 14px 16px;
`;

const AlertTitle = styled.Text`
  font-size: 17px;
  font-weight: 600;
  color: #000;
  text-align: center;
`;

const AlertMessage = styled.Text`
  margin-top: 6px;
  font-size: 13px;
  color: rgba(60, 60, 67, 0.85);
  line-height: 18px;
  text-align: center;
`;

const ActionsContainer = styled.View<{ twoColumn: boolean }>`
  border-top-width: 1px;
  border-top-color: rgba(60, 60, 67, 0.29);
  flex-direction: ${(props: { twoColumn: boolean }) => (props.twoColumn ? 'row' : 'column')};
`;

const ActionButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{
  twoColumn: boolean;
  addLeftBorder: boolean;
  addTopBorder: boolean;
}>`
  min-height: 44px;
  align-items: center;
  justify-content: center;
  flex: ${(props: { twoColumn: boolean }) => (props.twoColumn ? 1 : 'none')};
  border-left-width: ${(props: { addLeftBorder: boolean }) => (props.addLeftBorder ? 1 : 0)}px;
  border-left-color: rgba(60, 60, 67, 0.29);
  border-top-width: ${(props: { addTopBorder: boolean }) => (props.addTopBorder ? 1 : 0)}px;
  border-top-color: rgba(60, 60, 67, 0.29);
`;

const ActionText = styled.Text<{ destructive?: boolean; cancel?: boolean }>`
  text-align: center;
  font-size: 17px;
  font-weight: ${(props: { cancel?: boolean }) => (props.cancel ? 600 : 400)};
  color: ${(props: { destructive?: boolean }) => (props.destructive ? '#ff3b30' : '#007aff')};
`;
