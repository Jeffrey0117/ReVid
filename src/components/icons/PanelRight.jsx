import { Icon } from './Icon';

export const PanelRight = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
    </Icon>
);
