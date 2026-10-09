import React from 'react';
import { Avatar, Text, DropdownMenu, Button, Flex, Tooltip } from '@radix-ui/themes';
import QRCodeLogin from './QRCodeLogin';
import { useUserStore } from '../store/userStore';
import { useToast } from '../context/ToastContext';

const UserProfile: React.FC = () => {
  const { isLoggedIn, username, userId, avatar, roomId, logout } = useUserStore();
  const { showToast } = useToast();

  // 复制直播间ID到剪贴板
  const copyRoomId = () => {
    if (roomId) {
      navigator.clipboard
        .writeText(roomId.toString())
        .then(() => {
          showToast('已复制直播间ID', 'success');
        })
        .catch(err => {
          console.error('复制失败:', err);
          showToast('复制失败，请手动复制', 'error');
        });
    }
  };

  return (
    <div className="flex items-center">
      {isLoggedIn ? (
        <Flex align="center">
          {roomId && (
            <Flex align="center" gap="1" className="mr-1">
              <Tooltip content="点击复制直播间ID">
                <Button size="1" variant="ghost" color="gray" onClick={copyRoomId}>
                  直播间: {roomId}
                </Button>
              </Tooltip>
            </Flex>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="ghost" color="gray" className="!m-0">
                <Avatar size="2" src={avatar} fallback={username?.[0] || 'U'} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Label>
                <Text size="2">{username || '未知用户'}</Text>
              </DropdownMenu.Label>
              <DropdownMenu.Label>
                <Text size="1">用户ID: {userId}</Text>
              </DropdownMenu.Label>
              <DropdownMenu.Label>
                <Text size="1">直播间ID: {roomId}</Text>
              </DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                color="red"
                onClick={() => {
                  logout().catch(error => showToast(error instanceof Error ? error.message : '退出登录失败', 'error'));
                }}
              >
                退出登录
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
      ) : (
        <QRCodeLogin />
      )}
    </div>
  );
};

export default UserProfile;
