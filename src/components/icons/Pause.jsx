import { Icon } from './Icon';

export const Pause = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <rect x="14" y="4" width="4" height="16" rx="1" />
        <rect x="6" y="4" width="4" height="16" rx="1" />
    </Icon>
);
