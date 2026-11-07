import { Icon } from './Icon';

export const ArrowUp = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
    </Icon>
);
